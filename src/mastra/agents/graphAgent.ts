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
  Sections,
  Queries,
  SearchQuery,
  Feedback,
  Command,
  SourceReference
} from "../types/index.js";

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
 * レポート計画を生成する
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
    schema: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              search_query: { type: "string" }
            }
          }
        }
      }
    }
  });

  const queries = queriesResult.queries as SearchQuery[];
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
    schema: {
      type: "object",
      properties: {
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              research: { type: "boolean" },
              content: { type: "string" }
            }
          }
        }
      }
    }
  });

  return { sections: sectionsResult.sections as Section[] };
}

/**
 * ヒューマンフィードバックを処理する
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
    // 研究が必要なセクションの並列処理を開始
    const researchSections = sections.filter(s => s.research);
    return {
      goto: researchSections.map(s => ({
        target: "build-section-with-web-research",
        params: { topic, section: s, search_iterations: 0 }
      }))
    };
  } else {
    // フィードバックで再生成
    return {
      goto: "generate-report-plan",
      update: { feedback_on_report_plan: ["ユーザーフィードバック"] }
    };
  }
}

/**
 * セクションのための検索クエリを生成する
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
      schema: {
        type: "object",
        properties: {
          queries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                search_query: { type: "string" }
              }
            }
          }
        }
      }
    });

    return { search_queries: queriesResult.queries as SearchQuery[] };
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
    schema: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              search_query: { type: "string" }
            }
          }
        }
      }
    }
  });

  return { search_queries: queriesResult.queries as SearchQuery[] };
}

/**
 * Web検索を実行する
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
 * セクションを書き、評価する
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
  const sectionContent = await writerModel.generate({
    prompt: section_writer_instructions + "\n" + sectionWriterInputsFormatted + validSourcesText
  });

  // セクションの内容を更新
  section.content = sectionContent.text;

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
    schema: {
      type: "object",
      properties: {
        grade: { type: "string", enum: ["pass", "fail"] },
        follow_up_queries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              search_query: { type: "string" }
            }
          }
        }
      }
    }
  });

  const feedback = feedbackResult as Feedback;

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
 * 研究を必要としないセクションを書く
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
  const sectionContent = await writerModel.generate({
    prompt: systemInstructions + "\nGenerate a report section based on the provided sources."
  });

  // セクションの内容を更新
  section.content = sectionContent.text;

  return { completed_sections: [section] };
}

/**
 * 完了したセクションを収集する
 */
export function gatherCompletedSections(state: ReportState): Partial<ReportState> {
  const completedSections = state.completed_sections;
  const completedReportSections = formatSections(completedSections);

  return { report_sections_from_research: completedReportSections };
}

/**
 * 最終レポートをコンパイルする
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
 * 最終セクション作成を開始する（条件付きエッジ）
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



async function initModel(provider: string, model: string, kwargs?: any) {
  // Mastraのモデル初期化（実際の実装に合わせて調整が必要）
  if (provider === "openai") {
    const openaiModel = openai(model, kwargs);
    // AI SDKのopenaiモデルにはgenerateメソッドがないため、
    // generateTextやgenerateObjectを使用するためのラッパーを作成
    return {
      generate: async ({ prompt, schema }: { prompt: string, schema?: any }) => {
        try {
          if (schema) {
            // スキーマが提供されている場合はgenerateObjectを使用
            const ai = await import('ai');

            // スキーマをZodスキーマに変換
            const { z } = await import('zod');

            // Zodスキーマを作成
            let zodSchema;
            try {
              // クエリスキーマの場合
              if (schema.properties && schema.properties.queries) {
                zodSchema = z.object({
                  queries: z.array(
                    z.object({
                      search_query: z.string()
                    })
                  )
                });
              }
              // セクションスキーマの場合
              else if (schema.properties && schema.properties.sections) {
                zodSchema = z.object({
                  sections: z.array(
                    z.object({
                      name: z.string(),
                      description: z.string(),
                      research: z.boolean(),
                      content: z.string()
                    })
                  )
                });
              }
              // フィードバックスキーマの場合
              else if (schema.properties && schema.properties.grade) {
                zodSchema = z.object({
                  grade: z.enum(["pass", "fail"]),
                  follow_up_queries: z.array(
                    z.object({
                      search_query: z.string()
                    })
                  )
                });
              }
              // その他のスキーマの場合
              else {
                // デフォルトのスキーマを作成
                zodSchema = z.object({});
                Object.keys(schema.properties || {}).forEach(key => {
                  zodSchema = zodSchema.extend({
                    [key]: z.any()
                  });
                });
              }

              console.log("Using Zod schema:", JSON.stringify(zodSchema.shape, null, 2));

              const result = await ai.generateObject({
                model: openaiModel,
                prompt,
                schema: zodSchema,
                output: 'object'
              });

              // 型安全に処理
              const resultObj = result.object as Record<string, any>;

              // 結果オブジェクトを返す
              return {
                queries: resultObj.queries,
                sections: resultObj.sections,
                text: resultObj.text,
                grade: resultObj.grade,
                follow_up_queries: resultObj.follow_up_queries
              };
            } catch (schemaError) {
              console.error('Schema creation error:', schemaError);
              // スキーマ作成に失敗した場合はテキスト生成にフォールバック
              const result = await ai.generateText({
                model: openaiModel,
                prompt
              });
              return { text: result.text };
            }
          } else {
            // スキーマがない場合はgenerateTextを使用
            const ai = await import('ai');
            const result = await ai.generateText({
              model: openaiModel,
              prompt
            });
            return { text: result.text };
          }
        } catch (error) {
          console.error('Model generation error:', error);
          throw error;
        }
      }
    };
  }
  // 他のプロバイダーのサポートを追加
  throw new Error(`Unsupported provider: ${provider}`);
}

/**
 * 会話履歴を管理するヘルパー関数
 * @param messages 会話メッセージ
 * @param maxTokens 最大トークン数
 * @returns 最適化されたメッセージ
 */
function optimizeConversationHistory(messages: any[], maxTokens: number = 4000): any[] {
  // メッセージが少ない場合はそのまま返す
  if (messages.length <= 3) return messages;

  // システムメッセージと最新のユーザーメッセージは常に保持
  const systemMessages = messages.filter(m => m.role === 'system');
  const latestUserMessages = messages.filter(m => m.role === 'user').slice(-1);

  // 残りのメッセージから重要なものを選択
  const otherMessages = messages.filter(m =>
    m.role !== 'system' &&
    !(m.role === 'user' && latestUserMessages.includes(m))
  );

  // 最新のメッセージを優先して保持
  const optimizedMessages = [...systemMessages, ...otherMessages.slice(-3), ...latestUserMessages];

  return optimizedMessages;
}

/**
 * レポート生成関数 - トピックに基づいてレポートを生成する（エージェントを使用）
 * @param topic レポートのトピック
 * @param options メモリオプション（オプション）
 * @returns 生成されたレポート
 */
export async function generateReport(
  topic: string,
  options?: {
    threadId?: string;
    resourceId?: string;
    maxTokens?: number;
  }
): Promise<string> {
  try {
    // メモリオプションを設定
    const threadId = options?.threadId || `report-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const resourceId = options?.resourceId || `user-${Math.random().toString(36).substring(2, 9)}`;
    const maxTokens = options?.maxTokens || 4000;

    // エージェントを使用してレポートを生成
    const userMessage = {
      role: "user" as const,
      content: `トピック「${topic}」に関する包括的なレポートを生成してください。

以下の手順で進めてください：
1. まず、レポート計画を生成してください（generateReportPlanToolを使用）
2. 計画に基づいて、各セクションの研究と執筆を行ってください
3. 最終的なレポートを作成してください`
    };

    // メモリを使用してエージェントを呼び出す
    const result = await deepResearchAgent.generate([userMessage], {
      threadId,
      resourceId
    });

    return result.text;
  } catch (error) {
    // トークン制限エラーの場合
    if (error instanceof Error && error.message.includes('context length')) {
      console.warn('トークン制限エラー、会話履歴を最適化して再試行します');

      // 会話履歴を最適化して再試行
      const threadId = options?.threadId || `report-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const resourceId = options?.resourceId || `user-${Math.random().toString(36).substring(2, 9)}`;

      const userMessage = {
        role: "user" as const,
        content: `トピック「${topic}」に関する簡潔なレポートを生成してください。`
      };

      const result = await deepResearchAgent.generate([userMessage], {
        threadId,
        resourceId
      });

      return result.text + "\n\n(注: トークン制限のため、レポートは簡略化されています)";
    }

    console.error('レポート生成エラー:', error);
    // エラーを安全に処理
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`レポートの生成中にエラーが発生しました: ${errorMessage}`);
  }
}