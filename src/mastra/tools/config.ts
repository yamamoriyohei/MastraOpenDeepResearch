// デフォルトのレポート構造
export const DEFAULT_REPORT_STRUCTURE = `Use this structure to create a report on the user-provided topic:

1. Introduction (no research needed)
   - Brief overview of the topic area

2. Main Body Sections:
   - Each section should focus on a sub-topic of the user-provided topic

3. Conclusion
   - Aim for 1 structural element (either a list of table) that distills the main body sections
   - Provide a concise summary of the report`;

// 検索APIの列挙型
export enum SearchAPI {
    TAVILY = "tavily",
    DUCKDUCKGO = "duckduckgo"
}

// 設定インターフェース
export interface Configuration {
    // 共通設定
    report_structure: string;
    search_api: string;
    search_api_config?: Record<string, any>;

    // グラフ固有の設定
    number_of_queries: number;
    max_search_depth: number;
    planner_provider: string;
    planner_model: string;
    planner_model_kwargs?: Record<string, any>;
    writer_provider: string;
    writer_model: string;
    writer_model_kwargs?: Record<string, any>;

    // マルチエージェント固有の設定
    supervisor_model: string;
    researcher_model: string;

    // メモリ設定
    memory_enabled: boolean;
    memory_storage_type: string;
    memory_storage_url: string;
    memory_last_messages: number;
    memory_semantic_recall_topk: number;
    memory_semantic_recall_message_range: number;
}

// デフォルト設定
export const DEFAULT_CONFIGURATION: Configuration = {
    report_structure: DEFAULT_REPORT_STRUCTURE,
    search_api: SearchAPI.TAVILY,
    number_of_queries: 4, // クエリ数を増やして多様なソースを取得
    max_search_depth: 2,
    planner_provider: "openai",
    planner_model: "gpt-4.1",
    writer_provider: "openai",
    writer_model: "gpt-4.1",
    supervisor_model: "gpt-4.1",
    researcher_model: "gpt-4.1",

    // メモリ設定のデフォルト値
    memory_enabled: true,
    memory_storage_type: "libsql",
    memory_storage_url: "file:./mastra.db",
    memory_last_messages: 10,
    memory_semantic_recall_topk: 3,
    memory_semantic_recall_message_range: 2
};

/**
 * 環境変数または設定オブジェクトから設定を読み込む
 */
export async function loadConfig(configOverrides?: Partial<Configuration>): Promise<Configuration> {
    // 環境変数から設定を読み込む
    const envConfig: Partial<Configuration> = {
        report_structure: process.env.REPORT_STRUCTURE,
        search_api: process.env.SEARCH_API,
        number_of_queries: process.env.NUMBER_OF_QUERIES ? parseInt(process.env.NUMBER_OF_QUERIES) : undefined,
        max_search_depth: process.env.MAX_SEARCH_DEPTH ? parseInt(process.env.MAX_SEARCH_DEPTH) : undefined,
        planner_provider: process.env.PLANNER_PROVIDER,
        planner_model: process.env.PLANNER_MODEL,
        writer_provider: process.env.WRITER_PROVIDER,
        writer_model: process.env.WRITER_MODEL,
        supervisor_model: process.env.SUPERVISOR_MODEL,
        researcher_model: process.env.RESEARCHER_MODEL,

        // メモリ設定
        memory_enabled: process.env.MEMORY_ENABLED ? process.env.MEMORY_ENABLED === 'true' : undefined,
        memory_storage_type: process.env.MEMORY_STORAGE_TYPE,
        memory_storage_url: process.env.MEMORY_STORAGE_URL,
        memory_last_messages: process.env.MEMORY_LAST_MESSAGES ? parseInt(process.env.MEMORY_LAST_MESSAGES) : undefined,
        memory_semantic_recall_topk: process.env.MEMORY_SEMANTIC_RECALL_TOPK ? parseInt(process.env.MEMORY_SEMANTIC_RECALL_TOPK) : undefined,
        memory_semantic_recall_message_range: process.env.MEMORY_SEMANTIC_RECALL_MESSAGE_RANGE ? parseInt(process.env.MEMORY_SEMANTIC_RECALL_MESSAGE_RANGE) : undefined
    };

    // 環境変数から検索API設定を読み込む
    const searchApiConfigEnv: Record<string, any> = {};
    if (process.env.SEARCH_API_CONFIG) {
        try {
            Object.assign(searchApiConfigEnv, JSON.parse(process.env.SEARCH_API_CONFIG));
        } catch (error) {
            console.warn('Failed to parse SEARCH_API_CONFIG environment variable:', error);
        }
    }

    if (Object.keys(searchApiConfigEnv).length > 0) {
        envConfig.search_api_config = searchApiConfigEnv;
    }

    // モデルのkwargsを環境変数から読み込む
    const plannerModelKwargsEnv: Record<string, any> = {};
    if (process.env.PLANNER_MODEL_KWARGS) {
        try {
            Object.assign(plannerModelKwargsEnv, JSON.parse(process.env.PLANNER_MODEL_KWARGS));
        } catch (error) {
            console.warn('Failed to parse PLANNER_MODEL_KWARGS environment variable:', error);
        }
    }

    if (Object.keys(plannerModelKwargsEnv).length > 0) {
        envConfig.planner_model_kwargs = plannerModelKwargsEnv;
    }

    const writerModelKwargsEnv: Record<string, any> = {};
    if (process.env.WRITER_MODEL_KWARGS) {
        try {
            Object.assign(writerModelKwargsEnv, JSON.parse(process.env.WRITER_MODEL_KWARGS));
        } catch (error) {
            console.warn('Failed to parse WRITER_MODEL_KWARGS environment variable:', error);
        }
    }

    if (Object.keys(writerModelKwargsEnv).length > 0) {
        envConfig.writer_model_kwargs = writerModelKwargsEnv;
    }

    // 設定をマージする（デフォルト < 環境変数 < 引数で渡された設定）
    const mergedConfig: Configuration = {
        ...DEFAULT_CONFIGURATION,
        ...Object.fromEntries(
            Object.entries(envConfig).filter(([_, value]) => value !== undefined)
        ),
        ...Object.fromEntries(
            Object.entries(configOverrides || {}).filter(([_, value]) => value !== undefined)
        )
    };

    return mergedConfig;
}

/**
 * 実行時設定から設定を作成する
 */
export function fromRunnableConfig(config?: any): Promise<Configuration> {
    const configurable = config && config.configurable ? config.configurable : {};
    return loadConfig(configurable);
}