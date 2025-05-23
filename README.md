# MastraOpenDeepResearch

MastraOpenDeepResearchは、特定のトピックに関する包括的な調査レポートを自動生成するAIツールです。複数のソースから情報を収集し、構造化されたレポートを作成します。

## 特徴

- **自動リサーチ**: 指定されたトピックに関する情報を自動的に検索・収集
- **複数ソースの活用**: 少なくとも3つ以上の異なるソースから情報を収集し、多角的な視点を提供
- **構造化レポート**: 導入、本文、結論を含む整理されたレポートを生成
- **メモリ機能**: 過去の会話を記憶し、コンテキストを維持

## 必要条件

- Node.js 18.x以上
- npm 9.x以上
- OpenAI API キー
- Tavily API キー（Web検索用）

## セットアップ

### 1. リポジトリのクローン

```bash
git clone https://github.com/yamamoriyohei/MastraOpenDeepResearch.git
cd MastraOpenDeepResearch
```

### 2. 依存関係のインストール

```bash
npm install
```

### 3. 環境変数の設定

`.env`ファイルをプロジェクトのルートディレクトリに作成し、以下の内容を追加します：

```
# OpenAI API設定
OPENAI_API_KEY=your_openai_api_key_here

# Tavily API設定（Web検索用）
TAVILY_API_KEY=your_tavily_api_key_here

# ポート設定（オプション）
PORT=4115
```

## 起動方法

### 開発モード

```bash
npm run dev
```

開発サーバーが起動し、`http://localhost:4115`でアクセスできます。

### 本番モード

```bash
npm run build
npm start
```

## 使用方法

1. ブラウザで`http://localhost:4115`にアクセス
2. 調査したいトピックを入力
3. AIがトピックに関する情報を収集し、レポートを生成


## 主な機能

### DeepResearch

特定のトピックに関する包括的な調査を行い、構造化されたレポートを生成します。

1. **レポート計画の生成**: トピックに基づいて適切なセクション構成を計画
2. **検索クエリの生成**: 各セクションに関連する効果的な検索クエリを作成
3. **Web検索の実行**: 生成されたクエリを使用して情報を収集
4. **セクションの執筆**: 収集した情報に基づいて各セクションを執筆
5. **最終レポートの編集**: すべてのセクションを統合し、整形された最終レポートを生成

### メモリ機能

SQLiteを使用したメモリ機能により、過去の会話を記憶し、コンテキストを維持します。

- **会話履歴の保存**: ユーザーとの会話履歴をデータベースに保存
- **セマンティック検索**: 関連する過去の会話を検索して参照
- **コンテキスト維持**: 長期的な会話の流れを維持

今後としては、
Postgresによる実装に移行予定。



## 設定オプション

`mastra.config.js`ファイルで以下の設定を変更できます：

```javascript
// 検索設定
number_of_queries: 4,      // 生成する検索クエリの数
max_search_depth: 2,       // 最大検索深度
search_api: "tavily",      // 使用する検索API

// モデル設定
planner_model: "gpt-4.1",  // レポート計画生成に使用するモデル
writer_model: "gpt-4.1",   // セクション執筆に使用するモデル

// メモリ設定
memory_enabled: true,      // メモリ機能の有効/無効
memory_last_messages: 5,   // 保持する最新メッセージの数
```

## プロジェクト構造

```
MastraOpenDeepResearch/
├── .mastra/              # Mastraビルド出力
├── node_modules/         # 依存関係
├── public/               # 静的ファイル
├── src/                  # ソースコード
│   ├── mastra/           # Mastraアプリケーション
│   │   ├── agents/       # エージェント定義
│   │   ├── tools/        # ツール定義
│   │   └── types/        # 型定義
│   └── app/              # Webアプリケーション
├── .env                  # 環境変数
├── mastra.config.js      # Mastra設定
├── package.json          # パッケージ情報
└── README.md             # このファイル
```

## トラブルシューティング

### APIキーの問題

- OpenAI APIキーが正しく設定されていることを確認してください
- Tavily APIキーが正しく設定されていることを確認してください

### メモリ関連の問題

- SQLiteデータベースファイル（`mastra.db`）が書き込み可能であることを確認してください
- トークン制限エラーが発生した場合は、`mastra.config.js`の`memory_last_messages`の値を小さくしてみてください

### 検索結果の問題

- インターネット接続を確認してください
- Tavily APIの利用制限に達していないか確認してください


- [Mastra](https://github.com/mastraai/mastra) - AIエージェントフレームワーク
- [OpenDeepResearch](https://github.com/langchain-ai/open_deep_research) - deepresearchエージェント
  
