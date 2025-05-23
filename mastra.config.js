// mastra.config.js
export default {
  telemetry: {
    enabled: false
  },
  storage: {
    type: 'libsql',
    provider: 'libsql',
    url: 'file:./mastra.db',
    libsql: {
      url: 'file:./mastra.db'
    }
  },
  memory: {
    enabled: true,
    storage: {
      type: 'libsql',
      url: 'file:./mastra.db'
    },
    vector: {
      type: 'libsql',
      connectionUrl: 'file:./mastra.db'
    },
    embedder: {
      type: 'fastembed',
      // エンベディングの設定を最適化
      options: {
        batchSize: 16,       // バッチサイズを増やして処理を高速化
        maxTokens: 512,      // トークン数を制限してメモリ使用量を削減
        dimensions: 384      // 次元数を削減してストレージ使用量を削減
      }
    },
    options: {
      // 保持するメッセージ数を減らす（トークン制限対策）
      lastMessages: 5,
      semanticRecall: {
        // 関連性の高いメッセージのみを取得
        topK: 2,
        messageRange: 1
      }
    }
  },
  tracing: {
    enabled: false
  },
  logging: {
    enabled: true,
    level: 'info'
  },
  server: {
    port: 4115
  }
};
