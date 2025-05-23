import { deepResearchAgent } from "./mastra/agents/graphAgent.js";
import { randomUUID } from "crypto";

/**
 * メモリ機能のテスト
 */
async function testMemory() {
  try {
    console.log("メモリ機能のテストを開始します...");

    // メモリインスタンスを取得
    const memory = deepResearchAgent.getMemory();
    if (!memory) {
      throw new Error("メモリが初期化されていません");
    }

    console.log("メモリインスタンスを取得しました");

    // リソースIDを設定
    const resourceId = `user-${randomUUID().substring(0, 8)}`;
    console.log(`リソースID: ${resourceId}`);

    // 1. スレッドを作成
    console.log("\n1. スレッドを作成します...");
    const thread = await memory.createThread({
      resourceId,
      metadata: {
        topic: "メモリ機能のテスト",
        createdAt: new Date().toISOString()
      }
    });
    console.log(`スレッドを作成しました: ${thread.id}`);

    // 2. メッセージを追加
    console.log("\n2. メッセージを追加します...");
    await memory.addMessage({
      threadId: thread.id,
      message: {
        role: "user",
        content: "こんにちは、私の名前は山田太郎です。",
        id: randomUUID()
      }
    });
    console.log("ユーザーメッセージを追加しました");

    await memory.addMessage({
      threadId: thread.id,
      message: {
        role: "assistant",
        content: "こんにちは、山田太郎さん。お手伝いできることがあれば教えてください。",
        id: randomUUID()
      }
    });
    console.log("アシスタントメッセージを追加しました");

    await memory.addMessage({
      threadId: thread.id,
      message: {
        role: "user",
        content: "私の趣味は読書と旅行です。",
        id: randomUUID()
      }
    });
    console.log("ユーザーメッセージを追加しました");

    await memory.addMessage({
      threadId: thread.id,
      message: {
        role: "assistant",
        content: "読書と旅行が趣味なんですね。素晴らしいですね。どんな本や旅行先が好きですか？",
        id: randomUUID()
      }
    });
    console.log("アシスタントメッセージを追加しました");

    // 3. スレッドを取得
    console.log("\n3. スレッドを取得します...");
    const retrievedThread = await memory.getThreadById({
      threadId: thread.id
    });
    console.log(`スレッドID: ${retrievedThread?.id}`);
    console.log(`リソースID: ${retrievedThread?.resourceId}`);
    console.log(`メッセージ数: ${retrievedThread?.messages?.length || 0}`);

    if (retrievedThread?.messages) {
      console.log("\nメッセージ一覧:");
      retrievedThread.messages.forEach((msg, index) => {
        console.log(`メッセージ ${index + 1}:`);
        console.log(`- ロール: ${msg.role}`);
        console.log(`- 内容: ${msg.content}`);
      });
    }

    // 4. セマンティック検索を実行
    console.log("\n4. セマンティック検索を実行します...");
    const searchResults = await memory.query({
      threadId: thread.id,
      query: "山田さんの趣味は何ですか？",
      topK: 2,
      messageRange: 1
    });

    console.log(`検索結果数: ${searchResults.length}`);
    searchResults.forEach((result, index) => {
      console.log(`結果 ${index + 1}:`);
      console.log(`- スコア: ${result.score}`);
      console.log(`- メッセージ: ${result.message.content}`);
    });

    // 5. リソースIDに関連付けられたスレッドを取得
    console.log("\n5. リソースIDに関連付けられたスレッドを取得します...");
    const threads = await memory.getThreadsByResourceId({
      resourceId
    });

    console.log(`スレッド数: ${threads.length}`);
    threads.forEach((t, index) => {
      console.log(`スレッド ${index + 1}:`);
      console.log(`- ID: ${t.id}`);
      console.log(`- メタデータ: ${JSON.stringify(t.metadata)}`);
      console.log(`- メッセージ数: ${t.messages?.length || 0}`);
    });

    // 6. エージェントとの会話（メモリを使用）
    console.log("\n6. エージェントとの会話（メモリを使用）...");
    const response = await deepResearchAgent.stream(
      "私の趣味について教えてください。",
      {
        threadId: thread.id,
        resourceId,
        memoryOptions: {
          lastMessages: 10,
          semanticRecall: {
            topK: 3,
            messageRange: 2
          }
        }
      }
    );
    console.log(`エージェントの応答: ${response}`);

    console.log("\nメモリ機能のテストが完了しました。");
  } catch (error) {
    console.error("メモリテストエラー:", error);
    if (error instanceof Error) {
      console.error(`エラーメッセージ: ${error.message}`);
      console.error(`スタックトレース: ${error.stack}`);
    }
  }
}

// テストを実行
testMemory();
