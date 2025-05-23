import { z } from "zod";

// セクション定義のZodスキーマ
export const SectionSchema = z.object({
  name: z.string().describe("レポートのこのセクションの名前"),
  description: z.string().describe("このセクションで扱う主要なトピックと概念の簡単な概要"),
  research: z.boolean().describe("このセクションのためにウェブ検索を実行するかどうか"),
  content: z.string().optional().describe("セクションの内容"),
  sources: z.array(z.object({
    url: z.string().describe("参照URL"),
    title: z.string().describe("参照タイトル")
  })).optional().describe("参照ソース"),
});

// セクションのリストのZodスキーマ
export const SectionsSchema = z.object({
  sections: z.array(SectionSchema).describe("レポートのセクション"),
});

// 検索クエリのZodスキーマ
export const SearchQuerySchema = z.object({
  search_query: z.string().describe("ウェブ検索用のクエリ"),
});

// クエリのリストのZodスキーマ
export const QueriesSchema = z.object({
  queries: z.array(SearchQuerySchema).describe("検索クエリのリスト"),
});

// フィードバックのZodスキーマ
export const FeedbackSchema = z.object({
  grade: z.enum(["pass", "fail"]).describe("評価結果（'pass'は要件を満たす、'fail'は修正が必要）"),
  follow_up_queries: z.array(SearchQuerySchema).describe("フォローアップ検索クエリのリスト"),
});

// レポート状態の入力のZodスキーマ
export const ReportStateInputSchema = z.object({
  topic: z.string().describe("レポートのトピック"),
});

// レポート状態の出力のZodスキーマ
export const ReportStateOutputSchema = z.object({
  final_report: z.string().describe("最終レポート"),
});

// レポート状態のZodスキーマ
export const ReportStateSchema = z.object({
  topic: z.string().describe("レポートのトピック"),
  feedback_on_report_plan: z.string().optional().describe("レポート計画に関するフィードバック"),
  sections: z.array(SectionSchema).describe("レポートセクションのリスト"),
  completed_sections: z.array(SectionSchema).optional().describe("完了したセクションのリスト"),
  report_sections_from_research: z.string().optional().describe("最終セクションを書くための研究から完了したセクションの文字列"),
  final_report: z.string().optional().describe("最終レポート"),
});

// セクション状態のZodスキーマ
export const SectionStateSchema = z.object({
  topic: z.string().describe("レポートのトピック"),
  section: SectionSchema.describe("レポートセクション"),
  search_iterations: z.number().describe("実行された検索の繰り返し回数"),
  search_queries: z.array(SearchQuerySchema).describe("検索クエリのリスト"),
  source_str: z.string().describe("ウェブ検索からのフォーマットされたソースコンテンツの文字列"),
  report_sections_from_research: z.string().optional().describe("最終セクションを書くための研究から完了したセクションの文字列"),
  completed_sections: z.array(SectionSchema).optional().describe("完了したセクションのリスト"),
});

// セクション出力状態のZodスキーマ
export const SectionOutputStateSchema = z.object({
  completed_sections: z.array(SectionSchema).describe("完了したセクションのリスト"),
});

// 参照ソースのインターフェース
export interface SourceReference {
  url: string;
  title: string;
}

// TypeScriptの型定義（Zodスキーマから推論）
export type Section = z.infer<typeof SectionSchema>;
export type Sections = z.infer<typeof SectionsSchema>;
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type Queries = z.infer<typeof QueriesSchema>;
export type Feedback = z.infer<typeof FeedbackSchema>;
export type ReportStateInput = z.infer<typeof ReportStateInputSchema>;
export type ReportStateOutput = z.infer<typeof ReportStateOutputSchema>;
export type SectionState = z.infer<typeof SectionStateSchema>;
export type SectionOutputState = z.infer<typeof SectionOutputStateSchema>;

// コマンド型（ジェネリック型パラメータを使用）
export interface Command<T = string | any[]> {
  goto: T;                           // 次に実行するノードまたはノードのリスト
  update?: Record<string, any>;      // 状態の更新
}

// クエリ型（SearchQueryのエイリアス）
export type Query = SearchQuery;

// 状態の更新を追加
export interface ReportState {
  topic: string;                     // レポートのトピック
  feedback_on_report_plan?: string[];   // レポート計画に関するフィードバックのリスト
  sections: Section[];               // レポートセクションのリスト
  completed_sections: Section[];     // 完了したセクションのリスト
  report_sections_from_research?: string; // 最終セクションを書くための研究から完了したセクションの文字列
  final_report?: string;              // 最終レポート
}