// -----------------------------------------------------------------------------
// DEPRECATION NOTICE / STATUS: Single-Agent Workflow
//
// The `reportGenerationWorkflow` (MastraGraph instance) defined in this file 
// represents a previous single-agent architecture for report generation.
//
// CURRENT STATUS:
// This workflow is NO LONGER USED by the primary `generateReport` function,
// which now utilizes the multi-agent system orchestrated by the SupervisorAgent
// (see `src/mastra/agents/supervisorAgent.ts`).
//
// The individual node functions (e.g., `generateReportPlan`, `generateQueries`)
// originally designed for this graph are still partially reused by the 
// ResearcherAgent's tools, but the graph execution itself (`reportGenerationWorkflow.run()`)
// is not invoked in the main multi-agent flow.
//
// This file is kept for reference, potential future reuse of the graph pattern,
// or if a single-agent approach is desired for specific use cases.
// Consider removing it if it's confirmed to be permanently obsolete.
// -----------------------------------------------------------------------------

import {
  generateReportPlan,
  humanFeedback,
  generateQueries,
  searchWeb,
  writeSection,
  writeFinalSections,
  gatherCompletedSections,
  compileFinalReport,
} from "../agents/graphAgent";
import { ReportState, Command, Section } from "../types"; 

// -----------------------------------------------------------------------------
// IMPORTANT: MastraGraph Placeholder Implementation
// The `MastraGraph` class below is a placeholder. In a production environment,
// this would typically be imported from a core library like `@mastra/core`.
// This placeholder includes basic graph operations (addNode, addEdge, run)
// to simulate workflow execution for development and testing purposes.
// Replace with the actual MastraGraph implementation when available.
// -----------------------------------------------------------------------------

// import { MastraGraph } from "@mastra/core"; // Example of actual import

/**
 * Placeholder class for a Mastra Workflow Graph.
 * Manages nodes, edges, and the execution flow of a defined workflow.
 * @template TState The type of the state object managed by the graph.
 */
class MastraGraph<TState> {
  private nodes: Map<string, (state: TState, config?: any) => Promise<Partial<TState> | Command<any> | TState | any>> = new Map();
  private entryPoint: string | null = null;
  private edges: Map<string, string[]> = new Map(); // Stores direct edges
  private conditionalEdges: Map<string, Array<{ condition: (state: TState, commandResult: any) => boolean; to: string }>> = new Map(); // Stores conditional edges

  /**
   * Adds a node to the graph.
   * @param name The name of the node.
   * @param func The function to execute when this node is visited.
   */
  addNode(name: string, func: (state: TState, config?: any) => Promise<Partial<TState> | Command<any> | TState | any>): void {
    this.nodes.set(name, func);
  }

  /**
   * Sets the entry point for the graph.
   * @param name The name of the entry point node.
   */
  setEntryPoint(name: string): void {
    this.entryPoint = name;
  }

  /**
   * Adds a direct edge between two nodes.
   * @param from The name of the source node.
   * @param to The name of the target node.
   */
  addEdge(from: string, to: string): void {
    if (!this.edges.has(from)) {
      this.edges.set(from, []);
    }
    this.edges.get(from)!.push(to);
  }

  /**
   * Adds a conditional edge between two nodes.
   * The edge is traversed if the provided condition function returns true.
   * @param from The name of the source node.
   * @param to The name of the target node.
   * @param condition A function that takes the current state and command result, and returns a boolean.
   */
  addConditionalEdge(
    from: string,
    to: string, // Target node name
    condition: (state: TState, commandResult: Command<any>) => boolean // Condition function
  ): void {
    if (!this.conditionalEdges.has(from)) {
      this.conditionalEdges.set(from, []);
    }
    this.conditionalEdges.get(from)!.push({ condition, to });
  }

  /**
   * Runs the graph starting from the entry point with an initial state.
   * This is a basic conceptual execution logic.
   * @param initialState The initial state for the workflow.
   * @returns A promise that resolves to the final state of the workflow.
   * @throws Error if entry point is not set or a node is not found.
   */
  async run(initialState: TState): Promise<TState> {
    if (!this.entryPoint) throw new Error("MastraGraph: Entry point not set.");

    let currentNodeName = this.entryPoint;
    let currentState = { ...initialState };
    let maxSteps = 20; // Prevent infinite loops during conceptual execution

    while (maxSteps-- > 0) {
      const nodeFunc = this.nodes.get(currentNodeName);
      if (!nodeFunc) throw new Error(`Node ${currentNodeName} not found`);

      console.log(`Executing node: ${currentNodeName}`, currentState);
      const result = await nodeFunc(currentState, {}); // Pass empty config for now

      // Update state based on result
      if (result && typeof result === 'object') {
        if ('goto' in result && typeof result.goto === 'string') { // It's a Command
            currentState = { ...currentState, ...(result.update || {}) };
            const command = result as Command<string>;

            // Check conditional edges first
            const conditionalLinks = this.conditionalEdges.get(currentNodeName);
            let nextNodeFound = false;
            if (conditionalLinks) {
                for (const edge of conditionalLinks) {
                    // Pass currentState and the command itself to the condition function
                    if (edge.condition(currentState, command)) {
                        currentNodeName = edge.to;
                        nextNodeFound = true;
                        break;
                    }
                }
            }
            if (nextNodeFound) continue;

            // If no conditional edge taken, use direct command.goto
            if (command.goto === "END") {
                console.log(`Workflow ended by END command from ${currentNodeName}.`);
                // For 'write-section', "END" means the section is done.
                if (currentNodeName === "write-section") {
                    currentNodeName = "gather-completed-sections";
                    continue;
                }
                // For other nodes, "END" might mean something else or stop execution.
                // If it's 'compile-final-report' that returns a state with final_report, it's handled below.
                // If it's another node returning "END", this might be an unhandled terminal state.
                console.warn(`Unhandled "END" command from ${currentNodeName}. Stopping execution or specific handling needed.`);
                return currentState; // Or break, depending on desired behavior for unhandled END

            } else if (this.nodes.has(command.goto)) {
                currentNodeName = command.goto;
                continue;
            } else {
                 throw new Error(`Next node "${command.goto}" specified by command from "${currentNodeName}" not found or not a simple string goto.`);
            }

        } else { // It's a partial state update
            currentState = { ...currentState, ...result as Partial<TState> };
            const directEdges = this.edges.get(currentNodeName);
            if (directEdges && directEdges.length > 0) {
                currentNodeName = directEdges[0]; // Simple case: take the first direct edge
            } else {
                // If no direct edge and not a command, it might be an end node or a dead end.
                // For 'compile-final-report', this is expected.
                if (currentNodeName === "compile-final-report" && 'final_report' in currentState) {
                    console.log("Final report compiled and workflow finished.");
                    return currentState;
                }
                // If 'human-feedback' results in a state update without a 'goto' (e.g. just storing feedback),
                // it needs a defined next step. This placeholder assumes it must return a Command.
                throw new Error(`No direct edge from ${currentNodeName} and result was not a command. Current state: ${JSON.stringify(currentState)}`);
            }
        }
      } else {
         throw new Error(`Node ${currentNodeName} did not return a valid result.`);
      }
    }
    if (maxSteps <= 0) {
        console.error("Workflow exceeded maximum steps.");
    }
    return currentState;
  }
}
// End of MastraGraph Placeholder Implementation

/**
 * Routes tasks based on the current state of the report generation process.
 * It determines the next step by checking if all sections are complete or
 * by finding the first uncompleted section and deciding whether it needs research
 * or can be written directly.
 * @param state The current report state.
 * @returns A Command object indicating the next node to transition to and any state updates.
 */
export async function routeTasks(state: ReportState): Promise<Command> {
  const completedSectionsCount = state.completed_sections ? state.completed_sections.length : 0;

  if (!state.sections || state.sections.length === 0) {
    // No sections defined, perhaps an error or go to end.
    // This case should ideally be handled by generateReportPlan ensuring sections are created.
    console.warn("routeTasks: Called with no sections in state. Proceeding to compile-final-report.");
    return { goto: "compile-final-report" }; // Or an error state
  }
  
  if (completedSectionsCount === state.sections.length) {
    console.log("routeTasks: All sections completed. Proceeding to compile-final-report.");
    return { goto: "compile-final-report" };
  }

  let firstUncompletedSection: Section | null = null;
  // Find the first section in the original order that isn't marked as completed.
  for (const section of state.sections) {
    const isCompleted = state.completed_sections?.some(cs => cs.name === section.name);
    if (!isCompleted) {
      firstUncompletedSection = section;
      break;
    }
  }

  if (!firstUncompletedSection) {
    // This case implies all sections are completed, which should be caught by the first check.
    console.warn("routeTasks: No uncompleted section found, but not all sections appear complete. Proceeding to compile-final-report as a fallback.");
    return { goto: "compile-final-report" };
  }

  const currentSection = firstUncompletedSection;
  console.log(`routeTasks: Routing for section "${currentSection.name}". Research needed: ${currentSection.research}`);

  if (currentSection.research) {
    return {
      goto: 'generate-queries',
      update: {
        topic: state.topic,
        section: currentSection, // Pass the actual section object
        search_iterations: 0, // Reset for new section research
        // Preserve other necessary state parts
        sections: state.sections,
        completed_sections: state.completed_sections || [],
        feedback_on_report_plan: state.feedback_on_report_plan,
        report_sections_from_research: state.report_sections_from_research
      },
    };
  } else {
    return {
      goto: 'write-final-sections',
      update: {
        topic: state.topic,
        section: currentSection, // Pass the actual section object
        report_sections_from_research: state.report_sections_from_research || "",
        // Preserve other necessary state parts
        sections: state.sections,
        completed_sections: state.completed_sections || [],
        feedback_on_report_plan: state.feedback_on_report_plan
      },
    };
  }
}

/**
 * The main report generation workflow graph instance.
 */
export const graph = new MastraGraph<ReportState>();

// Define graph nodes
graph.addNode("generate-report-plan", generateReportPlan);
graph.addNode("human-feedback", humanFeedback); // humanFeedback will be modified
graph.addNode("route-tasks", routeTasks);
graph.addNode("generate-queries", generateQueries);
graph.addNode("search-web", searchWeb);
graph.addNode("write-section", writeSection);
graph.addNode("write-final-sections", writeFinalSections);
graph.addNode("gather-completed-sections", gatherCompletedSections);
graph.addNode("compile-final-report", compileFinalReport); // This is an end node

// Define graph edges
graph.setEntryPoint("generate-report-plan");
graph.addEdge("generate-report-plan", "human-feedback");

// Conditional edges from human-feedback
graph.addConditionalEdge("human-feedback", "generate-report-plan",
  (state, commandResult) => commandResult.goto === "generate-report-plan"
);
graph.addConditionalEdge("human-feedback", "route-tasks",
  (state, commandResult) => commandResult.goto === "route-tasks" // Assuming humanFeedback returns this on approval
);

// Conditional edges from route-tasks. The command's 'goto' directly names the next node.
// So, we need conditions that check commandResult.goto.
graph.addConditionalEdge("route-tasks", "generate-queries",
  (state, commandResult) => commandResult.goto === "generate-queries"
);
graph.addConditionalEdge("route-tasks", "write-final-sections",
  (state, commandResult) => commandResult.goto === "write-final-sections"
);
graph.addConditionalEdge("route-tasks", "compile-final-report",
  (state, commandResult) => commandResult.goto === "compile-final-report"
);

graph.addEdge("generate-queries", "search-web");
graph.addEdge("search-web", "write-section");

// Conditional edges from write-section
graph.addConditionalEdge("write-section", "search-web",
  (state, commandResult) => commandResult.goto === "search-web"
);
graph.addConditionalEdge("write-section", "gather-completed-sections",
  (state, commandResult) => commandResult.goto === "END" // "END" signifies completion of this section
);

graph.addEdge("write-final-sections", "gather-completed-sections");
graph.addEdge("gather-completed-sections", "route-tasks");

// compile-final-report is an end node, no outgoing edges by default.
// The graph runner should handle the state returned by this node as the final output.

export const reportGenerationWorkflow = graph;
