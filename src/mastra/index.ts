import { Mastra } from '@mastra/core';
import { deepResearchAgent } from './agents/graphAgent'; 
import { supervisorAgentPromise, runSupervisorWorkflow } from './agents/supervisorAgent';
import { researcherAgentPromise } from './agents/researcherAgent'; // Import researcher agent
import { LibSQLStore } from "@mastra/libsql";

const sqliteStore = new LibSQLStore({
  url: "file:./mastra.db" 
});

let mastraInstance: Mastra;

console.log("Initializing Mastra instance and Agents (Supervisor, Researcher)...");

// Use Promise.all to handle initialization of multiple agents
Promise.all([supervisorAgentPromise, researcherAgentPromise]).then(([supervisorAgent, researcherAgent]) => {
  console.log("Supervisor and Researcher Agents initialized successfully.");
  
  mastraInstance = new Mastra({
    agents: {
      deepResearchAgent, 
      supervisorAgent,   
      researcherAgent, // Add researcher agent
    },
    storage: sqliteStore,
    telemetry: {
      enabled: true,
      storage: sqliteStore
    },
    server: {
      port: 4115 
    }
  });
  console.log("Mastra instance configured with Supervisor and Researcher Agents.");
}).catch(error => {
  console.error("Failed to initialize one or more agents (Supervisor, Researcher):", error);
  // Fallback: Initialize Mastra with any agents that might have initialized or none
  // This part might need more sophisticated handling depending on which agent(s) failed
  // For now, attempting to initialize with deepResearchAgent only if others fail.
  let agents: Record<string, Agent> = { deepResearchAgent };
  try {
    // Check if supervisor resolved, if not, it will be undefined
    const supervisor = supervisorAgentPromise.catch(() => undefined); // get resolved value or undefined
    const researcher = researcherAgentPromise.catch(() => undefined);
    // This is tricky because the promises might not be settled yet to check their status directly.
    // A more robust fallback would involve checking the error object or having individual .then/.catch
    // For simplicity here, we'll just log and use what's available.
    console.warn("Attempting to initialize Mastra with available agents after error...");
    // This fallback logic is not perfect as promises might still be pending.
    // A better approach would be to have individual try-catches or more granular promise handling.
  } catch (e) { /* ignore secondary errors */ }

  mastraInstance = new Mastra({
    agents: { // Default to only deepResearchAgent if others failed critically
      deepResearchAgent,
      // supervisorAgent: supervisorAgentPromiseValue, // This would be complex to get here
      // researcherAgent: researcherAgentPromiseValue,
    },
    storage: sqliteStore,
    telemetry: {
      enabled: true,
      storage: sqliteStore
    },
    server: {
      port: 4115
    }
  });
  console.log("Mastra instance configured with available agents after initialization error.");
});


export const mastra = mastraInstance!; 

// エクスポート
export { 
  runSupervisorWorkflow as generateReport, 
  deepResearchAgent, 
  supervisorAgentPromise, 
  researcherAgentPromise // Export researcher agent promise
};
export * from './types';
export { reportGenerationWorkflow } from './workflows/flow';