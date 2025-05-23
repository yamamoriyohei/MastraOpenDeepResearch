import { generateReport } from "./mastra/agents/graphAgent.js";
import { randomUUID } from "crypto";

/**
 * レポート生成でメモリ機能をテストする
 */
async function testReportWithMemory() {
  try {
    console.log("レポート生成でメモリ機能のテストを開始します...");

    // リソースIDとスレッドIDを設定
    const resourceId = `user-${randomUUID().substring(0, 8)}`;
    const threadId = `report-${randomUUID().substring(0, 8)}`;
    console.log(`リソースID: ${resourceId}`);
    console.log(`スレッドID: ${threadId}`);

    // 1. 最初のレポート生成（メモリを使用）
    console.log("\n1. 最初のレポート生成を実行します...");
    const topic = "人工知能の歴史と未来";
    console.log(`トピック: ${topic}`);

    const report = await generateReport(topic, {
      threadId,
      resourceId
    });

    // レポートの一部を表示
    console.log("\nレポートの一部:");
    console.log(report.substring(0, 500) + "...");

    // 2. 同じスレッドで追加の質問
    console.log("\n2. 同じスレッドで追加の質問を行います...");

    // 同じエージェントを使用して、前のコンテキストを参照する質問をする
    const followUpQuestion = "先ほど生成したレポートの要点を3つにまとめてください。";
    console.log(`質問: ${followUpQuestion}`);

    const summary = await generateReport(followUpQuestion, {
      threadId,
      resourceId
    });

    console.log("\n要約結果:");
    console.log(summary);

    console.log("\nレポート生成でのメモリ機能のテストが完了しました。");
  } catch (error) {
    console.error("レポートメモリテストエラー:", error);
    if (error instanceof Error) {
      console.error(`エラーメッセージ: ${error.message}`);
      console.error(`スタックトレース: ${error.stack}`);
    }
  }
}

// テストを実行
testReportWithMemory();
