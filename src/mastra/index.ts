import { Mastra } from '@mastra/core';
import { deepResearchAgent, generateReport } from './agents/graphAgent';
import { LibSQLStore } from "@mastra/libsql";

const sqliteStore = new LibSQLStore({
  url: "file:./mastra.db"
});

export const mastra = new Mastra({
  agents: {
    deepResearchAgent,
  },
  // 両方のストレージに同じプロバイダーを使用
  storage: sqliteStore,
  telemetry: {
    enabled: true,
    storage: sqliteStore
  },
  server: {
    port: 4115
  }
});

// エクスポート
export { generateReport, deepResearchAgent };
export * from './types';
export { graph as reportGenerationWorkflow } from './workflows/flow';