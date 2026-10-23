import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { openai } from "@ai-sdk/openai";
import { z } from "zod"; // For defining tool schemas
import { Memory } from "@mastra/memory";
import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { fastembed } from "@mastra/fastembed";

import { SUPERVISOR_INSTRUCTIONS } from "../tools/promptTool";
import { 
    ReportState, 
    Section, 
    SearchQuery, // May not be directly used by supervisor, but good for context
    SectionSchema, // For tool output validation if returning full Section objects
    SectionsSchema, // For the outline tool
    QueriesSchema, // If any tool needs to deal with queries directly
    FeedbackSchema // If supervisor were to use grading/feedback logic internally
} from "../types/index.js";
import { loadConfig, Configuration } from "../tools/config";
import { initModel } from "../utils/modelUtils"; // Import from shared location

// Re-using selectAndExecuteSearch for the preliminary search tool
import { selectAndExecuteSearch, getSearchParams } from "../tools/utils";
import { runResearchForSection } from "./researcherAgent"; // Import the actual researcher function

// Re-using parts of graphAgent logic for supervisor tools
// These will be adapted or wrapped.
import {
  // generateReportPlan, // Logic will be adapted into preliminarySearchAndOutlineTool
  // writeFinalSections, // Logic will be adapted into writeNonResearchSectionTool
  compileFinalReport, // Will be wrapped by compileReportTool
  // The actual functions from graphAgent that perform LLM calls for planning and writing
  // might be too tightly coupled with the graph state.
  // We will re-implement the core LLM calls within the supervisor's tools,
  // using prompts from promptTool.ts
  report_planner_instructions, // For preliminarySearchAndOutlineTool
  final_section_writer_instructions, // For writeNonResearchSectionTool
  report_planner_query_writer_instructions, // For preliminary search part of outline tool
} from "../tools/promptTool"; 

// initModel is now imported from ../utils/modelUtils

// --- Supervisor Agent Tools ---

/**
 * Tool to perform preliminary research on a topic and generate a report outline (sections).
 */
const preliminarySearchAndOutlineTool = createTool({
  id: "preliminary-search-and-outline",
  description: "Performs initial web research on a topic and generates a structured report outline.",
  inputSchema: z.object({
    topic: z.string().describe("The main topic for the report."),
  }),
  outputSchema: z.object({ // Explicitly define output schema for clarity
    sections: z.array(SectionSchema),
  }),
  execute: async ({ topic }) => {
    console.log(`preliminarySearchAndOutlineTool: Starting for topic "${topic}"`);
    const configuration = await loadConfig();

    // 1. Generate search queries for initial context gathering
    const plannerQueryWriterModel = await initModel(configuration.planner_provider, configuration.planner_model, configuration.planner_model_kwargs);
    const initialSearchQueriesPrompt = report_planner_query_writer_instructions
      .replace("{topic}", topic)
      .replace("{report_organization}", "broad overview and key sub-topics") // Generic organization for initial search
      .replace("{number_of_queries}", "3"); // Generate a few queries for initial context

    const initialQueriesResult = await plannerQueryWriterModel.generate({
      prompt: initialSearchQueriesPrompt,
      zodSchema: QueriesSchema 
    });
    
    const searchQueries = initialQueriesResult.object.queries as SearchQuery[];
    const queryList = searchQueries.map(q => q.search_query);
    console.log(`preliminarySearchAndOutlineTool: Generated initial search queries:`, queryList);

    // 2. Perform web search
    const searchApi = configuration.search_api;
    const searchApiConfig = configuration.search_api_config || {};
    const paramsToPass = getSearchParams(searchApi, searchApiConfig);
    const searchContext = await selectAndExecuteSearch(searchApi, queryList, paramsToPass);
    console.log(`preliminarySearchAndOutlineTool: Web search completed. Context length: ${searchContext.formattedOutput.length}`);

    // 3. Generate report outline (sections)
    const plannerModel = await initModel(configuration.planner_provider, configuration.planner_model, configuration.planner_model_kwargs);
    const sectionsPrompt = report_planner_instructions // Using the detailed report_planner_instructions
      .replace("{topic}", topic)
      .replace("{report_organization}", configuration.report_structure) // Use configured report structure
      .replace("{context}", searchContext.formattedOutput)
      .replace("{feedback}", ""); // No feedback at this initial stage

    const sectionsResult = await plannerModel.generate({
      prompt: sectionsPrompt,
      zodSchema: SectionsSchema 
    });
    
    console.log(`preliminarySearchAndOutlineTool: Report outline generated successfully.`);
    return { sections: sectionsResult.object.sections as Section[] };
  },
});

/**
 * Tool to invoke the ResearcherAgent for a specific section.
 * Placeholder implementation: Returns dummy content.
 */
const invokeResearcherAgentTool = createTool({
  id: "invoke-researcher-agent",
  description: "Delegates research for a specific section to a ResearcherAgent.",
  inputSchema: z.object({
    topic: z.string().describe("The main topic of the report (for context)."),
    section_to_research: SectionSchema.describe("The section object that needs research."),
  }),
  outputSchema: z.object({ // Output schema for clarity
    completed_section: SectionSchema,
  }),
  execute: async ({ topic, section_to_research }) => {
    console.log(`invokeResearcherAgentTool: Starting actual research for section "${section_to_research.name}" on topic "${topic}"`);
    
    try {
      const completed_section = await runResearchForSection(topic, section_to_research);
      console.log(`invokeResearcherAgentTool: Actual research complete for section "${section_to_research.name}".`);
      return { completed_section };
    } catch (error) {
      console.error(`invokeResearcherAgentTool: Error during research for section "${section_to_research.name}".`, error);
      // Return the original section with an error message in its content, or handle error as appropriate
      const errored_section = { 
        ...section_to_research,
        content: `${section_to_research.content || ""}\n\n**Error during research: ${error instanceof Error ? error.message : String(error)}**`,
        // Optionally, mark research as false or add error flags
      };
      // It's important that the supervisor workflow can handle a failed section research.
      // Returning the section, even if errored, maintains the structure.
      // The supervisor's `runSupervisorWorkflow` should check for this.
      return { completed_section: errored_section }; 
    }
  },
});

/**
 * Tool to write content for non-research sections (e.g., Introduction, Conclusion).
 */
const writeNonResearchSectionTool = createTool({
  id: "write-non-research-section",
  description: "Writes content for sections that do not require new web research, using existing researched content as context.",
  inputSchema: z.object({
    topic: z.string().describe("The main topic of the report."),
    section_to_write: SectionSchema.describe("The section object to write (e.g., Introduction, Conclusion)."),
    all_researched_content: z.string().describe("A string concatenating all content from previously researched sections."),
  }),
  outputSchema: z.object({
    completed_section: SectionSchema,
  }),
  execute: async ({ topic, section_to_write, all_researched_content }) => {
    console.log(`writeNonResearchSectionTool: Writing non-research section "${section_to_write.name}" for topic "${topic}"`);
    const configuration = await loadConfig();
    const writerModel = await initModel(configuration.writer_provider, configuration.writer_model, configuration.writer_model_kwargs);

    const prompt = final_section_writer_instructions
      .replace("{topic}", topic)
      .replace("{section_name}", section_to_write.name)
      .replace("{section_topic}", section_to_write.description)
      .replace("{context}", all_researched_content);

    const contentResult = await writerModel.generate({ prompt }); // No Zod schema for plain text generation

    const completed_section = { ...section_to_write };
    completed_section.content = contentResult.text;
    
    console.log(`writeNonResearchSectionTool: Content generated for section "${section_to_write.name}".`);
    return { completed_section };
  },
});


// Need to import compileFinalReport from graphAgent.ts or move it to a shared location.
// For now, let's assume it's available or will be copied/imported.
// If compileFinalReport is small and self-contained, it can be redefined here or directly used.
// From graphAgent.ts:
// export function compileFinalReport(state: ReportState): ReportStateOutput
// It takes ReportState, which includes { sections: Section[], ... }
// and returns { final_report: string }

/**
 * Tool to compile the final report from all completed sections.
 */
const compileReportTool = createTool({
  id: "compile-report",
  description: "Compiles the final report from all completed sections, including adding references.",
  inputSchema: z.object({
    topic: z.string(), // Keep topic for consistency, though compileFinalReport might not use it directly
    sections: z.array(SectionSchema).describe("Array of all sections with their content populated."),
  }),
  outputSchema: z.object({
    final_report_text: z.string(),
  }),
  execute: async ({ sections, topic }) => { // topic is passed but compileFinalReport from graphAgent doesn't use it.
    console.log(`compileReportTool: Compiling final report for topic "${topic}" with ${sections.length} sections.`);
    
    // The original compileFinalReport takes a ReportState. We need to adapt.
    // Let's define a minimal version here or adapt the call.
    // For simplicity, let's use the structure of compileFinalReport directly.
    
    const completedSectionsMap = sections.reduce((acc, section) => {
        acc[section.name] = section.content || ""; // Ensure content is a string
        return acc;
    }, {} as Record<string, string>);

    // Ensure original section order is maintained and content is updated
    const finalSectionsWithContent: Section[] = sections.map(s => ({
        ...s,
        content: completedSectionsMap[s.name] || s.content || "" 
    }));
    
    const allSectionsText = finalSectionsWithContent.map(s => s.content).join("\n\n");

    const allSources: SourceReference[] = [];
    const usedUrls = new Set<string>();
    for (const section of finalSectionsWithContent) {
      if (section.sources && section.sources.length > 0) {
        for (const source of section.sources) {
          if (source.url && !usedUrls.has(source.url)) { // Ensure URL exists before adding
            allSources.push(source);
            usedUrls.add(source.url);
          }
        }
      }
    }

    let finalReportText = allSectionsText;
    if (allSources.length > 0) {
      finalReportText += "\n\n## 参考文献\n\n"; // Using Japanese "References" heading as in original
      allSources.forEach((source, index) => {
        finalReportText += `${index + 1}. [${source.title || 'Untitled'}](${source.url})\n`; // Ensure title exists
      });
    }
    
    console.log(`compileReportTool: Final report compiled. Length: ${finalReportText.length}`);
    return { final_report_text: finalReportText };
  },
});


// --- SupervisorAgent Class ---

// Configuration for the Supervisor Agent's memory
// Similar to deepResearchAgent, but can be tuned separately if needed.
const supervisorMemory = new Memory({
  storage: new LibSQLStore({
    url: "file:./mastra-supervisor.db" // Using a separate DB for supervisor for clarity
  }),
  vector: new LibSQLVector({
    connectionUrl: "file:./mastra-supervisor.db"
  }),
  embedder: fastembed,
  options: {
    lastMessages: 8, // Supervisor might need a bit more context of its own interactions
    semanticRecall: {
      topK: 3,
      messageRange: 1
    }
  }
});

// Define the Supervisor Agent
// Note: Model details will be loaded asynchronously within the agent or its workflow runner.
// For now, we define the structure. The actual model instance for the agent
// is typically handled by the Mastra framework when the agent processes a request,
// or we can load it explicitly in runSupervisorWorkflow.
// The Agent constructor itself might not need the model directly if it's configured globally
// or passed at runtime by the Mastra core. However, the provided Agent structure
// in graphAgent.ts shows model being passed in constructor.

// Let's assume we need to load config to get model name for the constructor.
// This is a bit problematic as class fields are initialized before async calls.
// A common pattern is to have an async factory or initialize model inside methods.
// For now, we'll follow the pattern in deepResearchAgent and load config for model name.
// This implies `loadConfig` should be synchronous or this part needs to be async.
// Given `loadConfig` is async, we'll need to handle this.
// A practical approach is to pass the model name string, and the Agent class handles async init,
// or the model is set dynamically. The Mastra Agent class might handle this.
// For now, let's assume openai() can take a string that's resolved later, or we make a wrapper.

// Simpler approach: Initialize config and model name here for clarity,
// though in a real app, this might be done within an async factory for the agent.

let supervisorAgentInstance: Agent;

// We need an async setup for the agent due to loadConfig
async function createSupervisorAgent(): Promise<Agent> {
  const config = await loadConfig();
  const supervisorModel = openai(config.supervisor_model || "gpt-4.1"); // Fallback to default

  return new Agent({
    name: "supervisor-agent",
    instructions: SUPERVISOR_INSTRUCTIONS,
    model: supervisorModel, // Pass the initialized model object
    tools: {
      preliminarySearchAndOutlineTool,
      invokeResearcherAgentTool,
      writeNonResearchSectionTool,
      compileReportTool,
    },
    memory: supervisorMemory,
  });
}

// Initialize the agent (this is an async operation)
// We'll export a promise that resolves to the agent, or the agent itself after init.
// For simplicity in this step, we'll export a function to get the agent.
// Or, handle this within runSupervisorWorkflow.

// For now, let's just define it and handle async init in runSupervisorWorkflow or export a promise.
// Let's try to create it and allow awaiting its creation.
export const supervisorAgentPromise = createSupervisorAgent(); // Export the promise

/**
 * Runs the supervisor workflow to generate a report on a given topic.
 * This function orchestrates the supervisor agent's tools to:
 * 1. Perform preliminary research and create a report outline.
 * 2. Invoke researcher agents (simulated) for sections requiring research.
 * 3. Write non-research sections (e.g., introduction, conclusion).
 * 4. Compile the final report.
 * @param topic The topic for the report.
 * @param initialMessage Optional initial message or context from the user.
 * @returns A promise that resolves to the final report text.
 */
export async function runSupervisorWorkflow(topic: string, initialMessage?: string): Promise<string> {
  console.log(`runSupervisorWorkflow: Starting for topic "${topic}"`);

  const supervisor = await supervisorAgentPromise; // Ensure the agent is initialized

  // Initialize ReportState (simplified for supervisor's direct management)
  let reportSections: Section[] = [];
  let completedSections: Section[] = [];
  let allResearchedContent = "";

  // 1. Preliminary Search and Outline
  console.log("runSupervisorWorkflow: Step 1 - Preliminary Search and Outline");
  const outlineResult = await supervisor.callTool("preliminary-search-and-outline", { topic });
  if (!outlineResult.toolCallOutput || !Array.isArray(outlineResult.toolCallOutput.sections)) {
    throw new Error("Failed to generate report outline.");
  }
  reportSections = outlineResult.toolCallOutput.sections;
  console.log(`runSupervisorWorkflow: Outline generated with ${reportSections.length} sections.`);

  // 2. Process Research Sections
  console.log("runSupervisorWorkflow: Step 2 - Processing Research Sections");
  for (const section of reportSections) {
    if (section.research) {
      console.log(`runSupervisorWorkflow: Invoking researcher for section: "${section.name}"`);
      const researcherResult = await supervisor.callTool("invoke-researcher-agent", {
        topic,
        section_to_research: section,
      });
      if (!researcherResult.toolCallOutput || !researcherResult.toolCallOutput.completed_section) {
        console.warn(`Failed to get research for section: ${section.name}. Skipping content.`);
        // Add original section to completed_sections to maintain structure, but content will be missing/placeholder
        completedSections.push(section); 
        continue;
      }
      const researchedSection = researcherResult.toolCallOutput.completed_section as Section;
      completedSections.push(researchedSection);
      allResearchedContent += `\n\n## ${researchedSection.name}\n${researchedSection.content || ""}`;
      console.log(`runSupervisorWorkflow: Research completed for section: "${researchedSection.name}"`);
    } else {
      // If not a research section, add it to completedSections as is, to be written later
      completedSections.push(section);
    }
  }
  
  // Ensure all sections are in completedSections, preserving order
  // This might be redundant if the loop logic is perfect, but good for safety.
  const finalSectionListForNonResearch: Section[] = reportSections.map(origSection => {
      const foundCompleted = completedSections.find(cs => cs.name === origSection.name);
      return foundCompleted || origSection; // Use completed if found, else original (e.g. if research failed)
  });
  completedSections = finalSectionListForNonResearch;


  // 3. Process Non-Research Sections (e.g., Introduction, Conclusion)
  console.log("runSupervisorWorkflow: Step 3 - Processing Non-Research Sections");
  const sectionsWrittenInThisStep: Section[] = [];
  for (let i = 0; i < completedSections.length; i++) {
    const section = completedSections[i];
    if (!section.research) { // Typically, sections that were initially !section.research
      // Or, if a section was marked for research but failed and has no content,
      // we might not want to call writeNonResearchSectionTool unless it's specifically intro/conclusion.
      // For now, assume any section with research:false is a candidate.
      console.log(`runSupervisorWorkflow: Writing non-research section: "${section.name}"`);
      const nonResearchResult = await supervisor.callTool("write-non-research-section", {
        topic,
        section_to_write: section,
        all_researched_content: allResearchedContent,
      });
      if (!nonResearchResult.toolCallOutput || !nonResearchResult.toolCallOutput.completed_section) {
         console.warn(`Failed to write non-research section: ${section.name}. Keeping original/placeholder content.`);
         sectionsWrittenInThisStep.push(section); // Keep original
      } else {
        sectionsWrittenInThisStep.push(nonResearchResult.toolCallOutput.completed_section as Section);
      }
       console.log(`runSupervisorWorkflow: Non-research section written: "${section.name}"`);
    } else {
        // This is a research section, already processed. Add it to the list for compiling.
        sectionsWrittenInThisStep.push(section);
    }
  }
  completedSections = sectionsWrittenInThisStep; // Update completedSections with newly written non-research content

  // 4. Compile Final Report
  console.log("runSupervisorWorkflow: Step 4 - Compiling Final Report");
  const compileResult = await supervisor.callTool("compile-report", {
    topic, // topic might not be strictly needed by compileReportTool's execute but good for context
    sections: completedSections,
  });

  if (!compileResult.toolCallOutput || typeof compileResult.toolCallOutput.final_report_text !== 'string') {
    throw new Error("Failed to compile the final report.");
  }

  console.log("runSupervisorWorkflow: Workflow completed. Final report compiled.");
  return compileResult.toolCallOutput.final_report_text;
}

console.log("supervisorAgent.ts: SupervisorAgent class structure and tools defined.");
