import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { Memory } from "@mastra/memory";
import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { fastembed } from "@mastra/fastembed";
import { loadConfig, Configuration } from "../tools/config";
import {
  report_planner_query_writer_instructions,
  report_planner_instructions,
  query_writer_instructions,
  section_writer_instructions,
  final_section_writer_instructions,
  section_grader_instructions,
  section_writer_inputs
} from "../tools/promptTool";
import {
  selectAndExecuteSearch,
  formatSections,
  getSearchParams
} from "../tools/utils";
import {
  ReportState,
  ReportStateInput,
  ReportStateOutput,
  SectionState,
  SectionOutputState,
  Section,
  // Sections type is used, SectionsSchema is the Zod schema
  Queries, // Queries type is used, QueriesSchema is the Zod schema
  SearchQuery,
  Feedback, // Feedback type is used, FeedbackSchema is the Zod schema
  Command,
  SourceReference,
  QueriesSchema, // Import static Zod schema
  SectionsSchema, // Import static Zod schema
  FeedbackSchema, // Import static Zod schema
} from "../types/index.js";
import { reportGenerationWorkflow } from "../workflows/flow"; // Import the graph

// ツールの定義
const generateReportPlanTool = createTool({
  id: "generate-report-plan",
  description: "トピックに基づいてレポート計画を生成する",
  inputSchema: z.object({
    topic: z.string().describe("レポートのトピック"),
    feedback: z.string().optional().describe("以前の計画に対するフィードバック"),
  }),
  execute: async (args) => {
    console.log("generateReportPlanTool args:", args);

    if (!args || !args.context || !args.context.topic) {
      throw new Error("トピックが指定されていません");
    }

    return await generateReportPlan({
      topic: args.context.topic,
      feedback_on_report_plan: args.context.feedback ? [args.context.feedback] : []
    }, {});
  },
});

const generateQueriesTool = createTool({
  id: "generate-queries",
  description: "セクションのための検索クエリを生成する",
  inputSchema: z.object({
    topic: z.string(),
    section: z.object({
      name: z.string(),
      description: z.string(),
      research: z.boolean(),
      content: z.string(),
    }),
  }),
  execute: async (args) => {
    console.log("generateQueriesTool args:", args);

    if (!args || !args.context || !args.context.topic) {
      throw new Error("トピックが指定されていません");
    }

    const state: Partial<SectionState> = {
      topic: args.context.topic,
      section: args.context.section as Section,
    };
    return await generateQueries(state as SectionState, {});
  },
});

const searchWebTool = createTool({
  id: "search-web",
  description: "Web検索を実行する",
  inputSchema: z.object({
    searchQueries: z.array(z.object({
      search_query: z.string(),
    })),
    searchIterations: z.number(),
  }),
  execute: async (args) => {
    console.log("searchWebTool args:", args);

    if (!args || !args.context || !args.context.searchQueries || !args.context.searchIterations) {
      throw new Error("検索クエリまたは検索回数が指定されていません");
    }

    const state: Partial<SectionState> = {
      search_queries: args.context.searchQueries as SearchQuery[],
      search_iterations: args.context.searchIterations,
    };
    return await searchWeb(state as SectionState, {});
  },
});

const writeSectionTool = createTool({
  id: "write-section",
  description: "セクションを書く",
  inputSchema: z.object({
    topic: z.string(),
    section: z.object({
      name: z.string(),
      description: z.string(),
      research: z.boolean(),
      content: z.string(),
    }),
    sourceStr: z.string(),
    searchIterations: z.number(),
  }),
  execute: async (args) => {
    console.log("writeSectionTool args:", args);

    if (!args || !args.context || !args.context.topic || !args.context.section ||
        !args.context.sourceStr || args.context.searchIterations === undefined) {
      throw new Error("必要なパラメータが指定されていません");
    }

    const state: Partial<SectionState> = {
      topic: args.context.topic,
      section: args.context.section as Section,
      source_str: args.context.sourceStr,
      search_iterations: args.context.searchIterations,
    };
    return await writeSection(state as SectionState, {});
  },
});

// Mastraエージェントの定義
// -----------------------------------------------------------------------------
// STATUS NOTICE: deepResearchAgent and Single-Agent Workflow Functions
//
// The `deepResearchAgent` and the associated graph node functions in this file 
// (e.g., `generateReportPlan`, `humanFeedback`, `generateQueries`, `searchWeb`, 
// `writeSection`, `writeFinalSections`, `gatherCompletedSections`, `compileFinalReport`, 
// `initiateFinalSectionWriting`) were part of the original single-agent graph-based 
// workflow (defined in `src/mastra/workflows/flow.ts`).
//
// CURRENT STATUS:
// - The `deepResearchAgent` itself is still registered in `src/mastra/index.ts` 
//   and might be usable for direct interactions if the Mastra framework supports it.
// - The main `generateReport` function in this file (which used to call 
//   `deepResearchAgent.generate(...)` or `reportGenerationWorkflow.run(...)`) 
//   has been superseded by `runSupervisorWorkflow` from `supervisorAgent.ts` 
//   as the primary entry point for report generation.
// - Several functions from this file (`generateQueries`, `searchWeb`, `writeSection`) 
//   are REUSED by the `ResearcherAgent` (`src/mastra/agents/researcherAgent.ts`) 
//   as part of the new multi-agent system.
// - The `reportGenerationWorkflow` itself (from `flow.ts`) is no longer the primary 
//   execution path.
//
// This agent and its functions are kept because:
// 1. Some functions are reused by the Researcher Agent.
// 2. The `deepResearchAgent` might still be invokable via Mastra core for other purposes.
// 3. They serve as a reference for the original single-agent implementation.
// -----------------------------------------------------------------------------
export const deepResearchAgent = new Agent({
  name: "deep-research-agent",
  instructions: `あなたは、包括的なレポートを生成する研究アシスタントです。

  あなたの役割：
  1. ユーザーが提供したトピックに基づいて、構造化されたレポート計画を生成する
  2. 各セクションについて必要な研究を行い、Web検索を通じて情報を収集する
  3. 収集した情報を基に、質の高いセクションを作成する
  4. すべてのセクションを組み合わせて、最終的なレポートを生成する

  プロセス：
  - まず、レポート計画を生成し、ユーザーの承認を得る
  - 承認後、各セクションの研究と執筆を行う
  - 必要に応じて追加の検索を行い、セクションの品質を向上させる
  - 最後に、すべてのセクションを統合して完成したレポートを提供する`,
  model: openai("gpt-4.1"),
  tools: {
    generateReportPlanTool,
    generateQueriesTool,
    searchWebTool,
    writeSectionTool,
  },
  // メモリを追加（SQLiteストレージプロバイダーを使用）
  memory: new Memory({
    storage: new LibSQLStore({
      url: "file:./mastra.db" // ローカルSQLiteデータベースを使用
    }),
    vector: new LibSQLVector({
      connectionUrl: "file:./mastra.db" // ベクトルストアにも同じデータベースを使用
    }),
    embedder: fastembed, // FastEmbedを使用（ローカルの埋め込みモデル）
    options: {
      lastMessages: 5, // 最新の5メッセージを取得（トークン制限対策）
      semanticRecall: {
        topK: 2, // セマンティック検索で上位2件を取得
        messageRange: 1 // 各一致の前後1メッセージを含める
      }
    }
  }),
});

// ノード関数の実装（元のまま）

/**
 * Generates a report plan based on the given topic and optional feedback.
 * This involves generating search queries related to the topic, performing a web search,
 * and then generating a structured list of sections for the report.
 * @param state The current report state, containing the topic and any feedback on previous plans.
 * @param config Optional configuration (currently unused by this node).
 * @returns A promise that resolves to a partial report state update with the generated sections.
 */
export async function generateReportPlan(state: ReportState, config: any): Promise<Partial<ReportState>> {
  const topic = state.topic;
  const feedbackList = state.feedback_on_report_plan || [];
  const feedback = feedbackList.length > 0 ? feedbackList.join(" /// ") : "";

  // 設定を取得
  const configuration = await loadConfig();
  const reportStructure = configuration.report_structure;
  const numberOfQueries = configuration.number_of_queries;
  const searchApi = configuration.search_api;
  const searchApiConfig = configuration.search_api_config || {};
  const paramsToPass = getSearchParams(searchApi, searchApiConfig);

  // クエリ生成
  const writerModel = await initModel(configuration.writer_provider, configuration.writer_model, configuration.writer_model_kwargs);

  // システム指示を作成
  const systemInstructionsQuery = report_planner_query_writer_instructions
    .replace("{topic}", topic)
    .replace("{report_organization}", reportStructure)
    .replace("{number_of_queries}", numberOfQueries.toString());

  // クエリを生成
  const queriesResult = await writerModel.generate({
    prompt: systemInstructionsQuery + "\nGenerate search queries that will help with planning the sections of the report.",
    zodSchema: QueriesSchema // Use imported Zod schema
  });

  const queries = queriesResult.object.queries as SearchQuery[];
  const queryList = queries.map(q => q.search_query);

  // Web検索を実行
  const sourceStr = await selectAndExecuteSearch(searchApi, queryList, paramsToPass);

  // セクション生成のためのシステム指示
  const systemInstructionsSections = report_planner_instructions
    .replace("{topic}", topic)
    .replace("{report_organization}", reportStructure)
    .replace("{context}", sourceStr)
    .replace("{feedback}", feedback);

  // プランナーモデルを初期化
  const plannerModel = await initModel(configuration.planner_provider, configuration.planner_model, configuration.planner_model_kwargs);

  // レポートセクションを生成
  const sectionsResult = await plannerModel.generate({
    prompt: systemInstructionsSections + "\nGenerate the sections of the report. Your response must include a 'sections' field containing a list of sections. Each section must have: name, description, research, and content fields.",
    zodSchema: SectionsSchema // Use imported Zod schema
  });

  return { sections: sectionsResult.object.sections as Section[] };
}

/**
 * Simulates a human feedback step. In a real application, this node would pause
 * and wait for external input. Currently, it auto-approves the plan.
 * If approved, it transitions to 'route-tasks'. If not (a path not currently taken),
 * it would go back to 'generate-report-plan' with feedback.
 * @param state The current report state, including the generated sections.
 * @param config Optional configuration (currently unused by this node).
 * @returns A promise that resolves to a Command indicating the next step and any state updates.
 */
export async function humanFeedback(state: ReportState, config: any): Promise<Command> {
  const topic = state.topic;
  const sections = state.sections;

  const sectionsStr = sections.map(section =>
    `Section: ${section.name}\n` +
    `Description: ${section.description}\n` +
    `Research needed: ${section.research ? 'Yes' : 'No'}\n`
  ).join("\n\n");

  // 実際の実装では、ここでユーザーインタラクションが必要
  // 現在は自動承認として実装
  console.log(`\nレポート計画:\n${sectionsStr}\n`);

  // 自動的に承認（実際の実装ではユーザー入力を待つ）
  const approved = true;

  if (approved) {
    // 承認された場合、route-tasksに移行する
    // researchSectionsのロジックはrouteTasks内で処理されるため、ここでは不要
    return Promise.resolve({
      goto: "route-tasks",
      update: {
        topic: state.topic,
        sections: state.sections,
        // feedback_on_report_plan はリセットまたは維持を選択できます。
        // ここでは、承認されたのでフィードバックはクリアされると仮定します。
        feedback_on_report_plan: [], 
        completed_sections: state.completed_sections || [],
        report_sections_from_research: state.report_sections_from_research
      }
    });
  } else {
    // フィードバックで再生成
    return Promise.resolve({
      goto: "generate-report-plan",
      update: { 
        topic: state.topic,
        sections: state.sections, // Keep existing sections for context if needed
        feedback_on_report_plan: ["ユーザーフィードバック"] // Example feedback
      }
    });
  }
}

/**
 * Generates search queries for a specific section of the report.
 * If the section description is missing, it formulates a generic query based on the section name or topic.
 * @param state The current section state, containing the topic and the section details.
 * @param config Optional configuration (currently unused by this node).
 * @returns A promise that resolves to a partial section state update with the generated search queries.
 */
export async function generateQueries(state: SectionState, config: any): Promise<Partial<SectionState>> {
  const topic = state.topic;
  const section = state.section;

  // セクションの説明が存在するか確認
  if (!section || !section.description) {
    console.error("セクションまたはセクションの説明が見つかりません:", section);
    // デフォルトの説明を設定
    const sectionDescription = section && section.name
      ? `${section.name}に関する情報`
      : `${topic}に関する情報`;

    const configuration = await loadConfig();
    const numberOfQueries = configuration.number_of_queries;

    // ライターモデルを初期化
    const writerModel = await initModel(configuration.writer_provider, configuration.writer_model, configuration.writer_model_kwargs);

    // システム指示を作成
    const systemInstructions = query_writer_instructions
      .replace("{topic}", topic)
      .replace("{section_topic}", sectionDescription)
      .replace("{number_of_queries}", numberOfQueries.toString());

    // クエリを生成
    const queriesResult = await writerModel.generate({
      prompt: systemInstructions + "\nGenerate search queries on the provided topic.",
      zodSchema: QueriesSchema // Use imported Zod schema
    });

    return { search_queries: queriesResult.object.queries as SearchQuery[] };
  }

  const configuration = await loadConfig();
  const numberOfQueries = configuration.number_of_queries;

  // ライターモデルを初期化
  const writerModel = await initModel(configuration.writer_provider, configuration.writer_model, configuration.writer_model_kwargs);

  // システム指示を作成
  const systemInstructions = query_writer_instructions
    .replace("{topic}", topic)
    .replace("{section_topic}", section.description)
    .replace("{number_of_queries}", numberOfQueries.toString());

  // クエリを生成
  const queriesResult = await writerModel.generate({
    prompt: systemInstructions + "\nGenerate search queries on the provided topic.",
    zodSchema: QueriesSchema // Use imported Zod schema
  });

  return { search_queries: queriesResult.object.queries as SearchQuery[] };
}

/**
 * Performs a web search using the generated queries for a section.
 * It uses the search API specified in the configuration and updates the section state
 * with the formatted search results string and an incremented search iteration count.
 * It also appends new, unique source references to the section.
 * @param state The current section state, including search queries and iteration count.
 * @param config Optional configuration (currently unused by this node).
 * @returns A promise that resolves to a partial section state update with search results and updated iteration count.
 */
export async function searchWeb(state: SectionState, config: any): Promise<Partial<SectionState>> {
  const searchQueries = state.search_queries;

  const configuration = await loadConfig();
  const searchApi = configuration.search_api;
  const searchApiConfig = configuration.search_api_config || {};
  const paramsToPass = getSearchParams(searchApi, searchApiConfig);

  // クエリリストを作成
  const queryList = searchQueries.map(query => query.search_query);

  // Web検索を実行
  const searchResult = await selectAndExecuteSearch(searchApi, queryList, paramsToPass);

  // セクションに参照ソースを追加
  if (state.section && searchResult.sources && searchResult.sources.length > 0) {
    if (!state.section.sources) {
      state.section.sources = [];
    }

    // 重複を避けるために既存のURLをチェック
    const existingUrls = new Set(state.section.sources.map(source => source.url));

    // 新しいソースを追加
    for (const source of searchResult.sources) {
      if (!existingUrls.has(source.url)) {
        state.section.sources.push(source);
        existingUrls.add(source.url);
      }
    }
  }

  return {
    source_str: searchResult.formattedOutput,
    search_iterations: state.search_iterations + 1
  };
}

/**
 * Writes the content for a specific section based on available search results (source string).
 * After writing, it grades the section. If the grade is 'pass' or max search depth is reached,
 * it marks the section as complete. Otherwise, it generates follow-up queries and transitions
 * back to 'search-web'.
 * @param state The current section state, including topic, section details, and search results.
 * @param config Optional configuration (currently unused by this node).
 * @returns A promise that resolves to a Command indicating the next step (either 'END' for this section or 'search-web').
 */
export async function writeSection(state: SectionState, config: any): Promise<Command> {
  const topic = state.topic;
  const section = state.section;
  const sourceStr = state.source_str;

  const configuration = await loadConfig();

  // セクション作成のためのシステム指示
  const sectionWriterInputsFormatted = section_writer_inputs
    .replace("{topic}", topic)
    .replace("{section_name}", section.name)
    .replace("{section_topic}", section.description)
    .replace("{section_content}", section.content || "")
    .replace("{context}", sourceStr);

  // ライターモデルを初期化
  const writerModel = await initModel(configuration.writer_provider, configuration.writer_model, configuration.writer_model_kwargs);

  // 有効なURLのリストを作成（検証済みのソースからのみ）
  let validSourcesText = "";
  if (section.sources && section.sources.length > 0) {
    validSourcesText = "\n\n<Valid Sources>\n";
    section.sources.forEach((source, index) => {
      validSourcesText += `${index + 1}. ${source.title}: ${source.url}\n`;
    });
    validSourcesText += "</Valid Sources>\n\n";

    // 有効なソースがない場合の警告
    if (section.sources.length === 0) {
      validSourcesText += "WARNING: No valid sources found. Please use ONLY the information provided in the source material.\n";
    }
  }

  // セクションを生成（有効なURLのリストを含める）
  const sectionContentResult = await writerModel.generate({ // No schema for this call
    prompt: section_writer_instructions + "\n" + sectionWriterInputsFormatted + validSourcesText
  });

  // セクションの内容を更新
  section.content = sectionContentResult.text;

  // セクション内容からURLを抽出して検証
  const urlRegex = /\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
  const extractedUrls: string[] = [];
  let match;

  while ((match = urlRegex.exec(section.content)) !== null) {
    extractedUrls.push(match[1]);
  }

  // 抽出したURLが有効なソースに含まれているか確認
  if (extractedUrls.length > 0 && section.sources) {
    const validUrls = new Set(section.sources.map(source => source.url));
    const invalidUrls: string[] = [];

    for (const url of extractedUrls) {
      if (!validUrls.has(url)) {
        invalidUrls.push(url);
      }
    }

    // 無効なURLがある場合は警告
    if (invalidUrls.length > 0) {
      console.warn(`セクション「${section.name}」に無効なURLが含まれています:`, invalidUrls);
    }
  }

  // セクションを評価
  const sectionGraderInstructionsFormatted = section_grader_instructions
    .replace("{topic}", topic)
    .replace("{section_topic}", section.description)
    .replace("{section}", section.content)
    .replace("{number_of_follow_up_queries}", configuration.number_of_queries.toString());

  // プランナーモデルで評価
  const plannerModel = await initModel(configuration.planner_provider, configuration.planner_model, configuration.planner_model_kwargs);

  const feedbackResult = await plannerModel.generate({
    prompt: sectionGraderInstructionsFormatted + "\nGrade the report and consider follow-up questions for missing information. If the grade is 'pass', return empty strings for all follow-up queries. If the grade is 'fail', provide specific search queries to gather missing information.",
    zodSchema: FeedbackSchema // Use imported Zod schema
  });

  const feedback = feedbackResult.object as Feedback;

  // セクションが合格または最大検索深度に達した場合
  if (feedback.grade === "pass" || state.search_iterations >= configuration.max_search_depth) {
    return {
      update: { completed_sections: [section] },
      goto: "END"
    };
  } else {
    // 新しい検索クエリで続行
    return {
      update: { search_queries: feedback.follow_up_queries, section: section },
      goto: "search-web"
    };
  }
}

/**
 * Writes content for sections that do not require web research (e.g., introduction, conclusion).
 * These sections are typically written based on the content of already completed (researched) sections.
 * @param state The current section state, including topic, section details, and content from researched sections.
 * @param config Optional configuration (currently unused by this node).
 * @returns A promise that resolves to a partial section output state update with the completed section.
 */
export async function writeFinalSections(state: SectionState, config: any): Promise<Partial<SectionOutputState>> {
  const topic = state.topic;
  const section = state.section;
  const completedReportSections = state.report_sections_from_research;

  const configuration = await loadConfig();

  // システム指示を作成
  const systemInstructions = final_section_writer_instructions
    .replace("{topic}", topic)
    .replace("{section_name}", section.name)
    .replace("{section_topic}", section.description)
    .replace("{context}", completedReportSections);

  // ライターモデルを初期化
  const writerModel = await initModel(configuration.writer_provider, configuration.writer_model, configuration.writer_model_kwargs);

  // セクションを生成
  const sectionContentResult = await writerModel.generate({ // No schema for this call
    prompt: systemInstructions + "\nGenerate a report section based on the provided sources."
  });

  // セクションの内容を更新
  section.content = sectionContentResult.text;

  return { completed_sections: [section] };
}

/**
 * Gathers all completed sections and formats their content into a single string.
 * This string can then be used as context for writing final sections like introductions or conclusions.
 * @param state The current report state, containing the list of all completed sections.
 * @returns A partial report state update with the formatted string of completed sections.
 */
export function gatherCompletedSections(state: ReportState): Partial<ReportState> {
  const completedSections = state.completed_sections;
  const completedReportSections = formatSections(completedSections);

  return { report_sections_from_research: completedReportSections };
}

/**
 * Compiles the final report by joining the content of all sections in their original order.
 * It also collects all unique source references from the sections and appends them to the report.
 * @param state The final report state, containing all sections with their content and sources.
 * @returns A report state output object containing the final compiled report string.
 */
export function compileFinalReport(state: ReportState): ReportStateOutput {
  const sections = state.sections;
  const completedSections = state.completed_sections.reduce((acc, section) => {
    acc[section.name] = section.content;
    return acc;
  }, {} as Record<string, string>);

  // 元の順序を維持しながらセクションを更新
  for (const section of sections) {
    section.content = completedSections[section.name] || section.content;
  }

  // 最終レポートをコンパイル
  const allSections = sections.map(s => s.content).join("\n\n");

  // 参照URLを収集
  const allSources: SourceReference[] = [];
  const usedUrls = new Set<string>();

  // 各セクションから参照URLを収集
  for (const section of sections) {
    if (section.sources && section.sources.length > 0) {
      for (const source of section.sources) {
        if (!usedUrls.has(source.url)) {
          allSources.push(source);
          usedUrls.add(source.url);
        }
      }
    }
  }

  // 参照URLがある場合は最終レポートに追加
  let finalReport = allSections;

  if (allSources.length > 0) {
    finalReport += "\n\n## 参考文献\n\n";
    allSources.forEach((source, index) => {
      finalReport += `${index + 1}. [${source.title}](${source.url})\n`;
    });
  }

  return { final_report: finalReport };
}

/**
 * Determines which sections do not require research and prepares them for parallel writing.
 * This function is intended for use with conditional edges or dynamic task dispatching in a graph.
 * Note: The current graph implementation in `flow.ts` uses `routeTasks` for sequential processing,
 * so this function might be for an alternative graph structure or future use.
 * @param state The current report state.
 * @returns An array of objects, each specifying a target node ('write-final-sections') and parameters for a non-research section.
 */
export function initiateFinalSectionWriting(state: ReportState): any[] {
  // 研究を必要としないセクションの並列書き込みタスクを開始
  return state.sections
    .filter(s => !s.research)
    .map(s => ({
      target: "write-final-sections",
      params: {
        topic: state.topic,
        section: s,
        report_sections_from_research: state.report_sections_from_research
      }
    }));
}

// ヘルパー関数



/**
 * Initializes a model provider based on the specified configuration.
 * Currently, only OpenAI is supported.
 * @param provider The name of the model provider (e.g., "openai").
 * @param model The specific model name (e.g., "gpt-4.1").
 * @param kwargs Optional keyword arguments for model initialization, such as temperature, topP, etc.
 * @returns An object with a `generate` method for text or structured object generation.
 * @throws Error if the provider is unsupported.
 */
async function initModel(provider: string, model: string, kwargs?: Record<string, any>) {
  // Encapsulate OpenAI specific logic
  if (provider === "openai") {
    const openaiModel = openai(model, kwargs);
    return {
      /**
       * Generates content using the initialized OpenAI model.
       * If a Zod schema is provided, it attempts to generate a structured object.
       * Otherwise, it generates plain text.
       * @param prompt The prompt to send to the model.
       * @param zodSchema Optional Zod schema for structured output. Its `description` field can be used for debugging.
       * @returns A promise that resolves to an object containing either the generated object (`object`) or text (`text`).
       * @throws Error if model generation fails, including schema validation errors.
       */
      generate: async ({ prompt, zodSchema }: { prompt: string, zodSchema?: z.ZodTypeAny }) => {
        const ai = await import('ai'); // Dynamically import 'ai' package
        try {
          if (zodSchema) {
            // Use generateObject with the provided Zod schema
            console.log("Attempting to generate object with Zod schema:", zodSchema.description || "No Zod schema description provided");
            const result = await ai.generateObject({
              model: openaiModel,
              prompt,
              schema: zodSchema, // Pass the Zod schema directly
            });
            // The result structure from ai.generateObject is { object: YourTypedObject }
            return { object: result.object }; 
          } else {
            // Fallback to generateText if no schema is provided
            console.log("Generating text (no Zod schema provided).");
            const result = await ai.generateText({
              model: openaiModel,
              prompt
            });
            return { text: result.text };
          }
        } catch (error) {
          console.error('Model generation error:', error);
          if (error instanceof Error && zodSchema) {
             console.error(`Error details related to Zod schema (${zodSchema.description || 'N/A'}):`, error.message);
          }
          throw error; // Re-throw the error to be handled by the caller
        }
      }
    };
  }
  // Placeholder for other providers
  // else if (provider === "anthropic") { /* ... */ }
  
  throw new Error(`Unsupported provider: ${provider}`);
}

// The function optimizeConversationHistory was removed as it was identified as unused code.

/**
 * レポート生成関数 - トピックに基づいてレポートを生成する（グラフワークフローを使用）
 * @param topic レポートのトピック
// import { ReportStateInputSchema } from "../types/index.js"; // No longer needed here

/**
 * レポート生成関数 - トピックに基づいてレポートを生成する（グラフワークフローを使用）
 * @param topic レポートのトピック
 * @param options オプション（現在は未使用だが、将来の拡張のために保持）
 * @returns 生成されたレポート
 */
export async function generateReport(
  topic: string,
  options?: { // Options are kept for potential future use (e.g., passing config to the graph)
    threadId?: string;
    resourceId?: string;
    maxTokens?: number; // This might be relevant for models used within graph nodes
  }
): Promise<string> {
  try {
    console.log(`generateReport: Starting report generation for topic "${topic}" using workflow.`);

    // 初期状態を定義
    // ReportStateInputSchema は topic のみを含むため、完全な ReportState を手動で作成
    const initialState: ReportState = {
      topic: topic,
      sections: [], // グラフの 'generate-report-plan' ノードで設定される
      completed_sections: [],
      feedback_on_report_plan: [], // 初期フィードバックなし
      // report_sections_from_research と final_report はワークフロー中に設定される
    };

    // ワークフロー（グラフ）を実行
    // reportGenerationWorkflow は src/mastra/workflows/flow.ts でエクスポートされた MastraGraph のインスタンス
    // placeholder MastraGraph には run メソッドがあると仮定
    const finalState = await reportGenerationWorkflow.run(initialState);

    if (finalState && finalState.final_report) {
      console.log(`generateReport: Workflow completed. Final report generated for topic "${topic}".`);
      return finalState.final_report;
    } else {
      console.error(`generateReport: Workflow finished but final_report is missing in the final state for topic "${topic}".`, finalState);
      throw new Error("レポート生成に失敗しました。最終レポートが生成されませんでした。");
    }
  } catch (error) {
    console.error(`generateReport: Error during report generation for topic "${topic}".`, error);
    // エラーを安全に処理
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Include the original error message for better debugging if needed
    throw new Error(`レポートの生成中にエラーが発生しました: ${errorMessage}`);
  }
}