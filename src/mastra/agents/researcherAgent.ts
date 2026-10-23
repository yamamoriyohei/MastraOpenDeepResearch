import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { Memory } from "@mastra/memory";
import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { fastembed } from "@mastra/fastembed";

import { RESEARCH_INSTRUCTIONS } from "../tools/promptTool";
import { 
    Section, 
    SearchQuery, 
    Feedback, 
    Command,
    SectionState, // For adapting calls to graphAgent functions
    SectionSchema,
    QueriesSchema, // For initModel calls if needed directly
    FeedbackSchema // For initModel calls if needed directly
} from "../types/index.js";
import { loadConfig, Configuration } from "../tools/config";
import { initModel } from "../utils/modelUtils"; // Import from shared location

// Functions to be reused from graphAgent.ts
// These are not tools themselves but orchestrating logic for graph nodes.
// We'll adapt their usage within the researcher's main tool.
import { 
    generateQueries as graphAgentGenerateQueries, 
    searchWeb as graphAgentSearchWeb, 
    writeSection as graphAgentWriteSection 
} from "./graphAgent"; 

// initModel is now imported from ../utils/modelUtils

// --- Researcher Agent Tool ---

/**
 * Orchestrates the research and writing process for a single report section.
 * It generates queries, searches the web, writes content, and self-critiques/refines
 * until the section is satisfactory or search depth is reached.
 */
const researchAndWriteSectionTool = createTool({
  id: "research-and-write-section",
  description: "Researches and writes a single section of a report, including web searches and content generation.",
  inputSchema: z.object({
    topic: z.string().describe("The main topic of the report (for context)."),
    section_to_research: SectionSchema.describe("The section object that needs research and writing."),
  }),
  outputSchema: z.object({
    completed_section: SectionSchema.describe("The section object after research and writing, with content and sources."),
  }),
  execute: async ({ topic, section_to_research }) => {
    console.log(`researchAndWriteSectionTool: Starting research for section "${section_to_research.name}" on topic "${topic}"`);
    const configuration = await loadConfig();
    let currentSectionState: SectionState = {
      topic: topic,
      section: { ...section_to_research }, // Work on a copy
      search_iterations: 0,
      search_queries: section_to_research.sources?.map(s => ({ search_query: s.title })) || [], // Initial queries if any from outline
      source_str: "",
      // report_sections_from_research: "", // Not needed for individual section research
      // completed_sections: [], // Not needed for individual section research
    };

    // Max search depth from config
    const max_search_depth = configuration.max_search_depth || 2;

    while (currentSectionState.search_iterations < max_search_depth) {
      // 1. Generate Queries (if not already present or if it's a follow-up)
      if (!currentSectionState.search_queries || currentSectionState.search_queries.length === 0) {
        console.log(`researchAndWriteSectionTool: Generating queries for section "${currentSectionState.section.name}"`);
        const queryStateUpdate = await graphAgentGenerateQueries(currentSectionState, configuration);
        currentSectionState = { ...currentSectionState, ...queryStateUpdate };
        if (!currentSectionState.search_queries || currentSectionState.search_queries.length === 0) {
          console.warn(`researchAndWriteSectionTool: No search queries generated for section "${currentSectionState.section.name}". Skipping search.`);
          // If no queries, we can't search or write effectively. Break or mark as failed.
          // For now, let's assume writeSection will handle lack of source_str.
          break; 
        }
      }
      console.log(`researchAndWriteSectionTool: Search queries for section "${currentSectionState.section.name}":`, currentSectionState.search_queries.map(q=>q.search_query));


      // 2. Search Web
      console.log(`researchAndWriteSectionTool: Performing web search for section "${currentSectionState.section.name}", iteration ${currentSectionState.search_iterations + 1}`);
      const searchStateUpdate = await graphAgentSearchWeb(currentSectionState, configuration);
      currentSectionState = { ...currentSectionState, ...searchStateUpdate };
      console.log(`researchAndWriteSectionTool: Web search complete for section "${currentSectionState.section.name}". Source string length: ${currentSectionState.source_str?.length || 0}`);


      // 3. Write Section (which includes grading)
      console.log(`researchAndWriteSectionTool: Writing section "${currentSectionState.section.name}"`);
      const writeCommand = await graphAgentWriteSection(currentSectionState, configuration);
      
      // Update section content from the write operation
      // graphAgentWriteSection modifies the section object in currentSectionState directly.
      // So, currentSectionState.section should have the latest content.

      if (writeCommand.goto === "END") {
        console.log(`researchAndWriteSectionTool: Section "${currentSectionState.section.name}" passed grading or max depth reached.`);
        break; // Section is complete
      } else if (writeCommand.goto === "search-web" && writeCommand.update?.search_queries) {
        console.log(`researchAndWriteSectionTool: Section "${currentSectionState.section.name}" needs more research. Follow-up queries generated.`);
        currentSectionState.search_queries = writeCommand.update.search_queries as SearchQuery[];
        // Iteration count is incremented by searchWeb, but if writeSection directly sends to search-web,
        // we might need to ensure it's correctly managed if searchWeb isn't called.
        // However, graphAgentSearchWeb increments it, and it's called at the start of the loop.
        // The iteration count is part of searchStateUpdate.
        if (currentSectionState.search_iterations >= max_search_depth) {
            console.log(`researchAndWriteSectionTool: Max search depth reached for section "${currentSectionState.section.name}" after feedback.`);
            break;
        }
      } else {
        console.warn(`researchAndWriteSectionTool: Unexpected command from writeSection for section "${currentSectionState.section.name}". Command:`, writeCommand);
        break; // Unknown state, break loop
      }
    }

    if (currentSectionState.search_iterations >= max_search_depth) {
        console.log(`researchAndWriteSectionTool: Max search depth (${max_search_depth}) reached for section "${currentSectionState.section.name}". Finalizing section.`);
    }
    
    console.log(`researchAndWriteSectionTool: Research and writing complete for section "${currentSectionState.section.name}".`);
    return { completed_section: currentSectionState.section };
  },
});

// --- ResearcherAgent Class ---

const researcherMemory = new Memory({
  storage: new LibSQLStore({
    url: "file:./mastra-researcher.db" 
  }),
  vector: new LibSQLVector({
    connectionUrl: "file:./mastra-researcher.db"
  }),
  embedder: fastembed,
  options: {
    lastMessages: 5, 
    semanticRecall: {
      topK: 2,
      messageRange: 1
    }
  }
});

// Asynchronous factory function for creating the ResearcherAgent
async function createResearcherAgent(): Promise<Agent> {
  const config = await loadConfig();
  const researcherModel = openai(config.researcher_model || "gpt-4.1"); // Fallback to default

  return new Agent({
    name: "researcher-agent",
    instructions: RESEARCH_INSTRUCTIONS,
    model: researcherModel,
    tools: {
      researchAndWriteSectionTool,
    },
    memory: researcherMemory,
  });
}

export const researcherAgentPromise = createResearcherAgent();

/**
 * Entry point function to run the research process for a single section using the ResearcherAgent.
 * @param topic The main topic of the report (for context).
 * @param section The section object that needs research and writing.
 * @returns A promise that resolves to the completed Section object.
 * @throws Error if the research and writing process fails.
 */
export async function runResearchForSection(topic: string, section: Section): Promise<Section> {
  console.log(`runResearchForSection: Initializing researcher agent for section "${section.name}" on topic "${topic}"`);
  const researcherAgent = await researcherAgentPromise;

  console.log(`runResearchForSection: Invoking researchAndWriteSectionTool for section "${section.name}"`);
  const result = await researcherAgent.callTool("research-and-write-section", {
    topic,
    section_to_research: section,
  });

  if (result.toolCallOutput && result.toolCallOutput.completed_section) {
    console.log(`runResearchForSection: Successfully completed research for section "${section.name}"`);
    return result.toolCallOutput.completed_section as Section;
  } else {
    console.error(`runResearchForSection: Failed to complete research for section "${section.name}". Tool output:`, result.toolCallOutput);
    throw new Error(`Research and writing failed for section: ${section.name}`);
  }
}

console.log("researcherAgent.ts: ResearcherAgent class structure, tools, and entry point defined.");
