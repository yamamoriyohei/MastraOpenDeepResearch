import { DuckDuckGoClient } from 'duckduckgo-client';
import axios from 'axios';
import { Section, SourceReference } from '../types/index.js';

// 型定義
interface SearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  raw_content?: string;
}

interface SearchResponse {
  query: string;
  follow_up_questions: string[] | null;
  answer: string | null;
  images: string[];
  results: SearchResult[];
  error?: string;
}

interface SearchApiConfig {
  max_results?: number;
  topic?: string;
  include_raw_content?: boolean;
  [key: string]: any;
}

// TavilyClient クラス（実際の実装はTavily SDKに依存）
class TavilyClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey || '';
  }

  async search(query: string, options: any): Promise<any> {
    try {
      const response = await axios.post(
        'https://api.tavily.com/search',
        {
          query,
          search_depth: options.search_depth || 'advanced',
          max_results: options.max_results || 5,
          include_raw_content: options.include_raw_content || true,
          topic: options.topic || 'general'
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      return response.data;
    } catch (error) {
      console.error('Tavily API error:', error);
      throw error;
    }
  }
}

// DuckDuckGo クライアント（実際の実装はDuckDuckGo SDKに依存）
// TODO: This is a placeholder client. Replace with actual DuckDuckGo SDK or a more robust API client.
class DuckDuckGoClient {
  async search(query: string, maxResults: number = 5): Promise<any[]> {
    try {
      // 実際の実装では、DuckDuckGo SDKを使用するか、APIを直接呼び出す
      // ここでは簡易的な実装を示す
      const response = await axios.get(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`
      );
      return response.data.RelatedTopics.slice(0, maxResults);
    } catch (error) {
      console.error('DuckDuckGo API error:', error);
      throw error;
    }
  }
}

/**
 * Retrieves a configuration value, handling cases where it might be an object with a 'value' property.
 * @param value The configuration value to process.
 * @returns The actual configuration value.
 */
export function getConfigValue(value: any): any {
  if (typeof value === 'string') {
    return value;
  } else if (typeof value === 'object' && value !== null) {
    return value;
  } else if (value && typeof value.value !== 'undefined') {
    return value.value;
  }
  return value;
}

/**
 * Filters search API configuration parameters to only include those accepted by the specified search API.
 * @param searchApi The name of the search API (e.g., "tavily").
 * @param searchApiConfig The full configuration object for search APIs.
 * @returns A filtered configuration object containing only parameters relevant to the specified search API.
 */
export function getSearchParams(searchApi: string, searchApiConfig?: SearchApiConfig): SearchApiConfig {
  // 各検索APIで受け付けるパラメータを定義
  const SEARCH_API_PARAMS: Record<string, string[]> = {
    "tavily": ["max_results", "topic", "include_raw_content"],
    // DuckDuckGoは現状パラメータを外部から受け付けないため、ここには含めない
  };

  // 指定された検索APIで受け付けるパラメータのリストを取得
  const acceptedParams = SEARCH_API_PARAMS[searchApi] || [];

  // 設定が提供されていない場合は空のオブジェクトを返す
  if (!searchApiConfig) {
    return {};
  }

  // 設定をフィルタリングして、受け付けるパラメータのみを含める
  return Object.fromEntries(
    Object.entries(searchApiConfig).filter(([key]) => acceptedParams.includes(key))
  );
}

/**
 * Formats a list of report sections into a single string for display or context.
 * @param sections An array of Section objects.
 * @returns A string representation of the sections.
 */
export function formatSections(sections: Section[]): string {
  let formattedStr = "";
  sections.forEach((section, idx) => {
    formattedStr += `
${'='.repeat(60)}
Section ${idx + 1}: ${section.name}
${'='.repeat(60)}
Description:
${section.description}
Requires Research:
${section.research}

Content:
${section.content ? section.content : '[Not yet written]'}

`;
  });
  return formattedStr;
}

/**
 * 検索結果のキャッシュ
 * 注意: このキャッシュは現在の実行セッション中のみ有効なインメモリキャッシュです。
 * 永続的なキャッシュや実行間のキャッシュが必要な場合は、
 * LibSQLStoreや他の永続ストレージメカニズムとの統合を検討する必要があります。
 */
const searchCache: Record<string, SearchResponse> = {};

/**
 * Performs searches using the Tavily API for a list of queries.
 * Implements batching, caching (in-memory, per-run), and error handling for individual queries.
 * @param searchQueries An array of search query strings.
 * @param maxResults The maximum number of results per query.
 * @param topic The topic for the search (e.g., "general", "research").
 * @param includeRawContent Whether to include raw content in the search results.
 * @returns A promise that resolves to an array of SearchResponse objects, maintaining original query order.
 */
export async function tavilySearchAsync(
  searchQueries: string[],
  maxResults: number = 5,
  topic: string = "general",
  includeRawContent: boolean = true
): Promise<SearchResponse[]> {
  const tavilyClient = new TavilyClient(process.env.TAVILY_API_KEY || '');

  // 検索クエリをバッチに分割（並列処理の最適化）
  const batchSize = 2; // 一度に処理するクエリの数
  const results: SearchResponse[] = [];

  // キャッシュされた結果を先に取得
  const cachedQueries: string[] = [];
  const uncachedQueries: string[] = [];

  for (const query of searchQueries) {
    const cacheKey = `${query}:${maxResults}:${topic}:${includeRawContent}`;
    if (searchCache[cacheKey]) {
      results.push(searchCache[cacheKey]);
      cachedQueries.push(query);
    } else {
      uncachedQueries.push(query);
    }
  }

  console.log(`キャッシュヒット: ${cachedQueries.length}/${searchQueries.length} クエリ`);

  // バッチ処理で残りのクエリを実行
  for (let i = 0; i < uncachedQueries.length; i += batchSize) {
    const batch = uncachedQueries.slice(i, i + batchSize);
    const searchPromises = batch.map(query => {
      return tavilyClient.search(query, {
        search_depth: "advanced",
        max_results: maxResults,
        include_raw_content: includeRawContent,
        topic: topic
      }).then(result => {
        // 結果をキャッシュに保存
        const cacheKey = `${query}:${maxResults}:${topic}:${includeRawContent}`;
        searchCache[cacheKey] = result;
        return result;
      });
    });

    try {
      // バッチ内の検索を並行して実行
      const batchResults = await Promise.all(searchPromises);
      results.push(...batchResults);

      // バッチ間に短い遅延を入れる（レート制限対策）
      if (i + batchSize < uncachedQueries.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error('Error in tavilySearchAsync batch:', error);
      // エラーが発生した場合は空の結果を返す
      const errorResponses = batch.map(query => ({
        query,
        follow_up_questions: null,
        answer: null,
        images: [],
        results: [],
        error: error instanceof Error ? error.message : String(error)
      }));
      results.push(...errorResponses);
    }
  }

  // 元のクエリ順序に合わせて結果を並べ替え
  const orderedResults: SearchResponse[] = [];
  for (const query of searchQueries) {
    const result = results.find(r => r.query === query);
    if (result) {
      orderedResults.push(result);
    }
  }

  return orderedResults;
}

/**
 * Scrapes content from a list of URLs and formats it into a single string.
 * Uses a basic HTML-to-Markdown conversion.
 * @param titles An array of titles corresponding to the URLs.
 * @param urls An array of URLs to scrape.
 * @returns A promise that resolves to a formatted string containing the scraped content.
 */
export async function scrapePages(titles: string[], urls: string[]): Promise<string> {
  // HTMLをMarkdownに変換する関数（実際の実装はmarkdownifyライブラリに依存）
  const markdownify = (html: string): string => {
    // 注意: このmarkdownify関数は非常に基本的なHTMLタグのみを処理します。
    // JavaScriptでレンダリングされるコンテンツ、複雑なCSSレイアウト、
    // または標準的でないHTML構造を持つ現代的なウェブページには不十分です。
    // より堅牢なスクレイピングとコンテンツ抽出のためには、
    // Puppeteer、Playwright、JSDOMのようなヘッドレスブラウザや、
    // Readability.jsのような高度な記事抽出ライブラリの使用を検討してください。
    return html
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
      .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''); // Remove all other tags
  };

  const pages: string[] = [];

  // 各URLからコンテンツを取得
  for (const url of urls) {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MastraBot/1.0; +https://mastra.ai)'
        },
        timeout: 30000,
        maxRedirects: 5
      });

      // コンテンツタイプに基づいて処理
      const contentType = response.headers['content-type'] || '';
      if (contentType.includes('text/html')) {
        // HTMLをMarkdownに変換
        const markdownContent = markdownify(response.data);
        pages.push(markdownContent);
      } else {
        // HTML以外のコンテンツタイプの場合
        pages.push(`Content type: ${contentType} (not converted to markdown)`);
      }
    } catch (error) {
      // 取得中にエラーが発生した場合
      pages.push(`Error fetching URL: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // フォーマットされた出力を作成
  let formattedOutput = `Search results: \n\n`;

  titles.forEach((title, i) => {
    if (i < urls.length && i < pages.length) {
      formattedOutput += `\n\n--- SOURCE ${i + 1}: ${title} ---\n`;
      formattedOutput += `URL: ${urls[i]}\n\n`;
      formattedOutput += `FULL CONTENT:\n ${pages[i]}`;
      formattedOutput += `\n\n${'-'.repeat(80)}\n`;
    }
  });

  return formattedOutput;
}

/**
 * Performs searches using a placeholder DuckDuckGo client for a list of queries.
 * Includes retry logic, error handling, and formats results into a string similar to `scrapePages`.
 * Note: This function currently relies on a basic placeholder for DuckDuckGo search.
 * @param searchQueries An array of search query strings.
 * @returns A promise that resolves to a string containing formatted search results or error messages.
 */
export async function duckduckgoSearch(searchQueries: string[]): Promise<string> {
  const processSingleQuery = async (query: string): Promise<SearchResponse> => {
    const performSearch = async (): Promise<SearchResponse> => {
      const maxRetries = 3;
      let retryCount = 0;
      const backoffFactor = 2.0;
      let lastError: Error | null = null;

      while (retryCount <= maxRetries) {
        try {
          const results: SearchResult[] = [];
          const ddgs = new DuckDuckGoClient();

          // リトライ間に遅延を追加し、クエリを少し変更
          if (retryCount > 0) {
            // 指数バックオフによるランダム遅延
            const delay = Math.pow(backoffFactor, retryCount) + Math.random();
            console.log(`Retry ${retryCount}/${maxRetries} for query '${query}' after ${delay.toFixed(2)}s delay`);
            await new Promise(resolve => setTimeout(resolve, delay * 1000));

            // キャッシュ/レート制限をバイパスするためにクエリにランダム要素を追加
            const modifiers = ['about', 'info', 'guide', 'overview', 'details', 'explained'];
            const modifiedQuery = `${query} ${modifiers[Math.floor(Math.random() * modifiers.length)]}`;
            const ddgResults = await ddgs.search(modifiedQuery, 5);

            // 結果をフォーマット
            ddgResults.forEach((result, i) => {
              results.push({
                title: result.Text || '',
                url: result.FirstURL || '',
                content: result.Text || '',
                score: 1.0 - (i * 0.1),
                raw_content: result.Text || ''
              });
            });
          } else {
            // 最初の試行
            const ddgResults = await ddgs.search(query, 5);

            // 結果をフォーマット
            ddgResults.forEach((result, i) => {
              results.push({
                title: result.Text || '',
                url: result.FirstURL || '',
                content: result.Text || '',
                score: 1.0 - (i * 0.1),
                raw_content: result.Text || ''
              });
            });
          }

          // 成功した結果を返す
          return {
            query,
            follow_up_questions: null,
            answer: null,
            images: [],
            results
          };
        } catch (error) {
          // 例外を保存してリトライ
          lastError = error instanceof Error ? error : new Error(String(error));
          retryCount++;
          console.log(`DuckDuckGo search error: ${lastError.message}. Retrying ${retryCount}/${maxRetries}`);

          // レート制限エラーでない場合はリトライしない
          if (!lastError.message.includes('Ratelimit') && retryCount >= 1) {
            console.log(`Non-rate limit error, stopping retries: ${lastError.message}`);
            break;
          }
        }
      }

      // すべてのリトライが失敗した場合
      console.log(`All retries failed for query '${query}': ${lastError?.message}`);
      // クエリ情報を保持した空の結果を返す
      return {
        query,
        follow_up_questions: null,
        answer: null,
        images: [],
        results: [],
        error: lastError?.message
      };
    };

    return await performSearch();
  };

  // クエリをレート制限を減らすために遅延を入れて処理
  const searchDocsResponses: SearchResponse[] = [];
  const urls: string[] = [];
  const titles: string[] = [];

  for (let i = 0; i < searchQueries.length; i++) {
    // クエリ間に遅延を追加（最初のクエリを除く）
    if (i > 0) {
      const delay = 2.0 + Math.random() * 2.0; // 2-4秒のランダム遅延
      await new Promise(resolve => setTimeout(resolve, delay * 1000));
    }

    // クエリを処理
    const result = await processSingleQuery(searchQueries[i]);
    searchDocsResponses.push(result);

    // 結果から安全にURLとタイトルを抽出
    if (result.results && result.results.length > 0) {
      result.results.forEach(res => {
        if (res.url && res.title) {
          urls.push(res.url);
          titles.push(res.title);
        }
      });
    }
  }

  // 有効なURLがある場合はページをスクレイピング
  if (urls.length > 0) {
    return await scrapePages(titles, urls);
  } else {
    // スクレイピングするURLがない場合
    // すべてのクエリが失敗したかどうかを確認
    let allFailedOrEmpty = true;
    for (const resp of searchDocsResponses) {
      if (resp.results && resp.results.length > 0) {
        allFailedOrEmpty = false;
        break;
      }
      if (!resp.error) {
        allFailedOrEmpty = false;
        break;
      }
    }

    if (allFailedOrEmpty && searchDocsResponses.length > 0) {
      // すべてのクエリにエラーがあった場合、エラーの概要を返す
      const errorsSummary: string[] = [];
      searchDocsResponses.forEach(resp => {
        if (resp.error) {
          errorsSummary.push(`Query '${resp.query}': ${resp.error}`);
        }
      });
      if (errorsSummary.length > 0) {
        return "DuckDuckGo search encountered errors:\n" + errorsSummary.join("\n");
      } else {
        return "No valid search results found from DuckDuckGo. Please try different search queries.";
      }
    }

    // 一部のクエリが成功したが、URLが得られなかった場合
    return "No valid search results found to scrape from DuckDuckGo. Please try different search queries or check for errors.";
  }
}

/**
 * Performs a search using the Tavily API and formats the results.
 * It de-duplicates results by URL and includes summaries and optional raw content.
 * @param queries An array of query strings.
 * @param options Configuration options for the Tavily search.
 * @returns A promise that resolves to an object containing the formatted output string and an array of source references.
 */
export async function tavilySearch(
  queries: string[],
  options: SearchApiConfig = {}
): Promise<{ formattedOutput: string, sources: SourceReference[] }> {
  // デフォルトでinclude_raw_content=trueを使用
  const includeRawContent = options.include_raw_content !== undefined ? options.include_raw_content : true;
  const maxResults = options.max_results || 8; // 結果数を増やして多様なソースを取得

  const searchApiResponses = await tavilySearchAsync(
    queries,
    maxResults,
    options.topic || 'general',
    includeRawContent
  );

  // 参照ソースを保存するための配列
  const sources: SourceReference[] = [];

  // 検索結果を直接フォーマット
  let formattedOutput = `Search results from Tavily: \n\n`;

  // すべてのクエリにわたってURLで結果を重複排除
  const uniqueResults: Record<string, SearchResult> = {};
  for (const response of searchApiResponses) {
    if (response && response.results) {
      for (const result of response.results) {
        const url = result.url;
        if (url && !uniqueResults[url]) {
          uniqueResults[url] = result;
        }
      }
    }
  }

  // ユニークな結果をフォーマット
  if (Object.keys(uniqueResults).length === 0) {
    // レスポンスにエラーがあるかチェック
    const errors: string[] = [];
    for (const resp of searchApiResponses) {
      if (resp && resp.error) {
        errors.push(`Query '${resp.query || 'Unknown'}': ${resp.error}`);
      }
    }
    if (errors.length > 0) {
      return {
        formattedOutput: "Tavily search encountered errors:\n" + errors.join("\n"),
        sources: []
      };
    }
    return {
      formattedOutput: "No valid search results found from Tavily. Please try different search queries.",
      sources: []
    };
  }

  let sourceCount = 0;
  for (const [url, result] of Object.entries(uniqueResults)) {
    sourceCount++;
    formattedOutput += `\n\n--- SOURCE ${sourceCount}: ${result.title || 'No Title'} ---\n`;
    formattedOutput += `URL: ${url}\n\n`;

    // 参照ソースを追加
    sources.push({
      url: url,
      title: result.title || 'No Title'
    });

    const contentSnippet = result.content || '';
    if (contentSnippet) {
      formattedOutput += `SUMMARY:\n${contentSnippet}\n\n`;
    }

    if (includeRawContent && result.raw_content) {
      // 表示用にコンテンツサイズを制限
      let rawContentDisplay = result.raw_content.substring(0, 30000);
      if (result.raw_content.length > 30000) {
        rawContentDisplay += "... [truncated]";
      }
      formattedOutput += `FULL CONTENT (up to 30000 chars):\n${rawContentDisplay}`;
    } else if (!contentSnippet && !(includeRawContent && result.raw_content)) {
      formattedOutput += "No content available for this source.\n";
    }

    formattedOutput += "\n\n" + "-".repeat(80) + "\n";
  }

  return { formattedOutput, sources };
}

/**
 * Validates a URL by checking its format and attempting a HEAD request.
 * Only allows http and https protocols.
 * @param url The URL string to validate.
 * @returns A promise that resolves to true if the URL is valid and accessible, false otherwise.
 */
export async function isValidUrl(url: string): Promise<boolean> {
  try {
    // URLの形式を確認
    const urlObj = new URL(url);

    // http/httpsスキームのみを許可
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return false;
    }

    // 実際にアクセスできるか確認（ヘッドリクエストのみ）
    try {
      const response = await axios.head(url, {
        timeout: 5000, // 5秒でタイムアウト
        maxRedirects: 3,
        validateStatus: (status) => status < 400 // 400未満のステータスコードは成功とみなす
      });
      return true;
    } catch (error) {
      console.warn(`URL検証エラー: ${url} - ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  } catch (error) {
    // URLの形式が無効
    return false;
  }
}

/**
 * Selects and executes a search using the specified search API (Tavily or DuckDuckGo).
 * It formats the output and validates URLs for Tavily results.
 * @param searchApi The name of the search API to use ("tavily" or "duckduckgo").
 * @param queryList An array of query strings.
 * @param paramsToPass Configuration parameters to pass to the search API.
 * @returns A promise that resolves to an object containing the formatted output string and an array of source references.
 * @throws Error if an unsupported search API is specified.
 */
export async function selectAndExecuteSearch(
  searchApi: string,
  queryList: string[],
  paramsToPass: SearchApiConfig = {}
): Promise<{ formattedOutput: string, sources: SourceReference[] }> {
  if (searchApi === "tavily") {
    // Tavily検索ツールを使用
    const result = await tavilySearch(queryList, paramsToPass);

    // URLを検証
    const validatedSources: SourceReference[] = [];
    for (const source of result.sources) {
      if (await isValidUrl(source.url)) {
        validatedSources.push(source);
      } else {
        console.warn(`無効なURLを除外: ${source.url}`);
      }
    }

    return {
      formattedOutput: result.formattedOutput,
      sources: validatedSources
    };
  } else if (searchApi === "duckduckgo") {
    // DuckDuckGo検索ツールを使用
    const result = await duckduckgoSearch(queryList);
    // DuckDuckGoの場合は空のソースリストを返す（将来的に実装予定）
    return { formattedOutput: result, sources: [] };
  } else {
    throw new Error(`Unsupported search API: ${searchApi}. Only 'tavily' and 'duckduckgo' are supported.`);
  }
}

