import { stremioService, Meta, Manifest } from './stremioService';
import { notificationService } from './notificationService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { TMDBService } from './tmdbService';
import { logger } from '../utils/logger';
import { getCatalogDisplayName } from '../utils/catalogNameUtils';

// Add a constant for storing the data source preference
const DATA_SOURCE_KEY = 'discover_data_source';

// Define data source types
export enum DataSource {
  STREMIO_ADDONS = 'stremio_addons',
  TMDB = 'tmdb',
}

export interface StreamingAddon {
  id: string;
  name: string;
  version: string;
  description: string;
  types: string[];
  catalogs: {
    type: string;
    id: string;
    name: string;
    extraSupported?: string[];
    extra?: Array<{ name: string; options?: string[] }>;
  }[];
  resources: {
    name: string;
    types: string[];
    idPrefixes?: string[];
  }[];
  url?: string; // preferred base URL (manifest or original)
  originalUrl?: string; // original addon URL if provided
  transportUrl?: string;
  transportName?: string;
}

export interface AddonSearchResults {
  addonId: string;
  addonName: string;
  results: StreamingContent[];
}

export interface GroupedSearchResults {
  byAddon: AddonSearchResults[];
  allResults: StreamingContent[]; // Deduplicated flat list for backwards compatibility
}

export interface StreamingContent {
  id: string;
  type: string;
  name: string;
  poster: string;
  posterShape?: string;
  banner?: string;
  logo?: string;
  imdbRating?: string;
  year?: number;
  genres?: string[];
  description?: string;
  runtime?: string;
  released?: string;
  trailerStreams?: any[];
  videos?: any[];
  inLibrary?: boolean;
  directors?: string[];
  creators?: string[];
  certification?: string;
  // Enhanced metadata from addons
  country?: string;
  writer?: string[];
  links?: Array<{
    name: string;
    category: string;
    url: string;
  }>;
  behaviorHints?: {
    defaultVideoId?: string;
    hasScheduledVideos?: boolean;
    [key: string]: any;
  };
  imdb_id?: string;
  slug?: string;
  releaseInfo?: string;
  traktSource?: 'watchlist' | 'continue-watching' | 'watched';
  addonCast?: Array<{
    id: number;
    name: string;
    character: string;
    profile_path: string | null;
  }>;
}

export interface CatalogContent {
  addon: string;
  type: string;
  id: string;
  name: string;
  genre?: string;
  items: StreamingContent[];
}

const CATALOG_SETTINGS_KEY = 'catalog_settings';

class CatalogService {
  private static instance: CatalogService;
  private readonly LEGACY_LIBRARY_KEY = 'stremio-library';
  private readonly RECENT_CONTENT_KEY = 'stremio-recent-content';
  private library: Record<string, StreamingContent> = {};
  private recentContent: StreamingContent[] = [];
  private readonly MAX_RECENT_ITEMS = 20;
  private librarySubscribers: ((items: StreamingContent[]) => void)[] = [];
  private libraryAddListeners: ((item: StreamingContent) => void)[] = [];
  private libraryRemoveListeners: ((type: string, id: string) => void)[] = [];

  private constructor() {
    this.loadLibrary();
    this.loadRecentContent();
  }

  static getInstance(): CatalogService {
    if (!CatalogService.instance) {
      CatalogService.instance = new CatalogService();
    }
    return CatalogService.instance;
  }

  private async loadLibrary(): Promise<void> {
    try {
      const scope = (await AsyncStorage.getItem('@user:current')) || 'local';
      const scopedKey = `@user:${scope}:stremio-library`;
      let storedLibrary = (await AsyncStorage.getItem(scopedKey));
      if (!storedLibrary) {
        // Fallback: read legacy and migrate into scoped
        storedLibrary = await AsyncStorage.getItem(this.LEGACY_LIBRARY_KEY);
        if (storedLibrary) {
          await AsyncStorage.setItem(scopedKey, storedLibrary);
        }
      }
      if (storedLibrary) {
        this.library = JSON.parse(storedLibrary);
      }
    } catch (error: any) {
      logger.error('Failed to load library:', error);
    }
  }

  private async saveLibrary(): Promise<void> {
    try {
      const scope = (await AsyncStorage.getItem('@user:current')) || 'local';
      const scopedKey = `@user:${scope}:stremio-library`;
      await AsyncStorage.setItem(scopedKey, JSON.stringify(this.library));
      await AsyncStorage.setItem(this.LEGACY_LIBRARY_KEY, JSON.stringify(this.library));
    } catch (error: any) {
      logger.error('Failed to save library:', error);
    }
  }

  private async loadRecentContent(): Promise<void> {
    try {
      const storedRecentContent = await AsyncStorage.getItem(this.RECENT_CONTENT_KEY);
      if (storedRecentContent) {
        this.recentContent = JSON.parse(storedRecentContent);
      }
    } catch (error: any) {
      logger.error('Failed to load recent content:', error);
    }
  }

  private async saveRecentContent(): Promise<void> {
    try {
      await AsyncStorage.setItem(this.RECENT_CONTENT_KEY, JSON.stringify(this.recentContent));
    } catch (error: any) {
      logger.error('Failed to save recent content:', error);
    }
  }

  async getAllAddons(): Promise<StreamingAddon[]> {
    const addons = await stremioService.getInstalledAddonsAsync();
    return addons.map(addon => this.convertManifestToStreamingAddon(addon));
  }

  private convertManifestToStreamingAddon(manifest: Manifest): StreamingAddon {
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      types: manifest.types || [],
      catalogs: manifest.catalogs || [],
      resources: manifest.resources || [],
      url: (manifest.url || manifest.originalUrl) as any,
      originalUrl: (manifest.originalUrl || manifest.url) as any,
      transportUrl: manifest.url,
      transportName: manifest.name
    };
  }

  async getHomeCatalogs(): Promise<CatalogContent[]> {
    const addons = await this.getAllAddons();
    
    // Load enabled/disabled settings
    const catalogSettingsJson = await AsyncStorage.getItem(CATALOG_SETTINGS_KEY);
    const catalogSettings = catalogSettingsJson ? JSON.parse(catalogSettingsJson) : {};

    // Create an array of promises for all catalog fetches
    const catalogPromises: Promise<CatalogContent | null>[] = [];

    // Process addons in order (they're already returned in order from getAllAddons)
    for (const addon of addons) {
      if (addon.catalogs) {
        for (const catalog of addon.catalogs) {
          const settingKey = `${addon.id}:${catalog.type}:${catalog.id}`;
          const isEnabled = catalogSettings[settingKey] ?? true;

          if (isEnabled) {
            // Create a promise for each catalog fetch
            const catalogPromise = (async () => {
              try {
                // Hoist manifest list retrieval and find once
                const addonManifests = await stremioService.getInstalledAddonsAsync();
                const manifest = addonManifests.find(a => a.id === addon.id);
                if (!manifest) return null;

                const metas = await stremioService.getCatalog(manifest, catalog.type, catalog.id, 1);
                if (metas && metas.length > 0) {
                  // Cap items per catalog to reduce memory and rendering load
                  const limited = metas.slice(0, 12);
                  const items = limited.map(meta => this.convertMetaToStreamingContent(meta));
                  
                  // Get potentially custom display name; if customized, respect it as-is
                  const originalName = catalog.name || catalog.id;
                  let displayName = await getCatalogDisplayName(addon.id, catalog.type, catalog.id, originalName);
                  const isCustom = displayName !== originalName;

                  if (!isCustom) {
                    // Remove duplicate words and clean up the name (case-insensitive)
                    const words = displayName.split(' ');
                    const uniqueWords: string[] = [];
                    const seenWords = new Set<string>();
                    for (const word of words) {
                      const lowerWord = word.toLowerCase();
                      if (!seenWords.has(lowerWord)) {
                        uniqueWords.push(word);
                        seenWords.add(lowerWord);
                      }
                    }
                    displayName = uniqueWords.join(' ');

                    // Add content type if not present
                    const contentType = catalog.type === 'movie' ? 'Movies' : 'TV Shows';
                    if (!displayName.toLowerCase().includes(contentType.toLowerCase())) {
                      displayName = `${displayName} ${contentType}`;
                    }
                  }
                  
                  return {
                    addon: addon.id,
                    type: catalog.type,
                    id: catalog.id,
                    name: displayName,
                    items
                  };
                }
                return null;
              } catch (error) {
                logger.error(`Failed to load ${catalog.name} from ${addon.name}:`, error);
                return null;
              }
            })();
            
            catalogPromises.push(catalogPromise);
          }
        }
      }
    }

    // Wait for all catalog fetch promises to resolve in parallel
    const catalogResults = await Promise.all(catalogPromises);
    
    // Filter out null results
    return catalogResults.filter(catalog => catalog !== null) as CatalogContent[];
  }

  async getCatalogByType(type: string, genreFilter?: string): Promise<CatalogContent[]> {
    // Get the data source preference (default to Stremio addons)
    const dataSourcePreference = await this.getDataSourcePreference();
    
    // If TMDB is selected as the data source, use TMDB API
    if (dataSourcePreference === DataSource.TMDB) {
      return this.getCatalogByTypeFromTMDB(type, genreFilter);
    }
    
    // Otherwise use the original Stremio addons method
    const addons = await this.getAllAddons();
    
    const typeAddons = addons.filter(addon => 
      addon.catalogs && addon.catalogs.some(catalog => catalog.type === type)
    );

    // Create an array of promises for all catalog fetches
    const catalogPromises: Promise<CatalogContent | null>[] = [];

    for (const addon of typeAddons) {
      const typeCatalogs = addon.catalogs.filter(catalog => catalog.type === type);

      for (const catalog of typeCatalogs) {
        const catalogPromise = (async () => {
          try {
            const addonManifest = await stremioService.getInstalledAddonsAsync();
            const manifest = addonManifest.find(a => a.id === addon.id);
            if (!manifest) return null;

            const filters = genreFilter ? [{ title: 'genre', value: genreFilter }] : [];
            const metas = await stremioService.getCatalog(manifest, type, catalog.id, 1, filters);
            
            if (metas && metas.length > 0) {
              const items = metas.map(meta => this.convertMetaToStreamingContent(meta));
              
              // Get potentially custom display name
              const displayName = await getCatalogDisplayName(addon.id, catalog.type, catalog.id, catalog.name);
              
              return {
                addon: addon.id,
                type,
                id: catalog.id,
                name: displayName,
                genre: genreFilter,
                items
              };
            }
            return null;
          } catch (error) {
            logger.error(`Failed to get catalog ${catalog.id} for addon ${addon.id}:`, error);
            return null;
          }
        })();
        
        catalogPromises.push(catalogPromise);
      }
    }

    // Wait for all catalog fetch promises to resolve in parallel
    const catalogResults = await Promise.all(catalogPromises);
    
    // Filter out null results
    return catalogResults.filter(catalog => catalog !== null) as CatalogContent[];
  }

  /**
   * Get catalog content from TMDB by type and genre
   */
  private async getCatalogByTypeFromTMDB(type: string, genreFilter?: string): Promise<CatalogContent[]> {
    const tmdbService = TMDBService.getInstance();
    const catalogs: CatalogContent[] = [];
    
    try {
      // Map Stremio content type to TMDB content type
      const tmdbType = type === 'movie' ? 'movie' : 'tv';
      
      // If no genre filter or All is selected, get multiple catalogs
      if (!genreFilter || genreFilter === 'All') {
        // Create an array of promises for all catalog fetches
        const catalogFetchPromises = [
          // Trending catalog
          (async () => {
            const trendingItems = await tmdbService.getTrending(tmdbType, 'week');
            const trendingItemsPromises = trendingItems.map(item => this.convertTMDBToStreamingContent(item, tmdbType));
            const trendingStreamingItems = await Promise.all(trendingItemsPromises);
            
            return {
              addon: 'tmdb',
              type,
              id: 'trending',
              name: `Trending ${type === 'movie' ? 'Movies' : 'TV Shows'}`,
              items: trendingStreamingItems
            };
          })(),
          
          // Popular catalog
          (async () => {
            const popularItems = await tmdbService.getPopular(tmdbType, 1);
            const popularItemsPromises = popularItems.map(item => this.convertTMDBToStreamingContent(item, tmdbType));
            const popularStreamingItems = await Promise.all(popularItemsPromises);
            
            return {
              addon: 'tmdb',
              type,
              id: 'popular',
              name: `Popular ${type === 'movie' ? 'Movies' : 'TV Shows'}`,
              items: popularStreamingItems
            };
          })(),
          
          // Upcoming/on air catalog
          (async () => {
            const upcomingItems = await tmdbService.getUpcoming(tmdbType, 1);
            const upcomingItemsPromises = upcomingItems.map(item => this.convertTMDBToStreamingContent(item, tmdbType));
            const upcomingStreamingItems = await Promise.all(upcomingItemsPromises);
            
            return {
              addon: 'tmdb',
              type,
              id: 'upcoming',
              name: type === 'movie' ? 'Upcoming Movies' : 'On Air TV Shows',
              items: upcomingStreamingItems
            };
          })()
        ];
        
        // Wait for all catalog fetches to complete in parallel
        return await Promise.all(catalogFetchPromises);
      } else {
        // Get content by genre
        const genreItems = await tmdbService.discoverByGenre(tmdbType, genreFilter);
        const streamingItemsPromises = genreItems.map(item => this.convertTMDBToStreamingContent(item, tmdbType));
        const streamingItems = await Promise.all(streamingItemsPromises);
        
        return [{
          addon: 'tmdb',
          type,
          id: 'discover',
          name: `${genreFilter} ${type === 'movie' ? 'Movies' : 'TV Shows'}`,
          genre: genreFilter,
          items: streamingItems
        }];
      }
    } catch (error) {
      logger.error(`Failed to get catalog from TMDB for type ${type}, genre ${genreFilter}:`, error);
      return [];
    }
  }

  /**
   * Convert TMDB trending/discover result to StreamingContent format
   */
  private async convertTMDBToStreamingContent(item: any, type: 'movie' | 'tv'): Promise<StreamingContent> {
    const id = item.external_ids?.imdb_id || `tmdb:${item.id}`;
    const name = type === 'movie' ? item.title : item.name;
    const posterPath = item.poster_path;
    
    // Get genres from genre_ids
    let genres: string[] = [];
    if (item.genre_ids && item.genre_ids.length > 0) {
      try {
        const tmdbService = TMDBService.getInstance();
        const genreLists = type === 'movie' 
          ? await tmdbService.getMovieGenres() 
          : await tmdbService.getTvGenres();
        
        const genreIds: number[] = item.genre_ids;
        genres = genreIds
          .map(genreId => {
            const genre = genreLists.find(g => g.id === genreId);
            return genre ? genre.name : null;
          })
          .filter(Boolean) as string[];
      } catch (error) {
        logger.error('Failed to get genres for TMDB content:', error);
      }
    }
    
    return {
      id,
      type: type === 'movie' ? 'movie' : 'series',
      name: name || 'Unknown',
      poster: posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : 'https://via.placeholder.com/300x450/cccccc/666666?text=No+Image',
      posterShape: 'poster',
      banner: item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : undefined,
      year: type === 'movie' 
        ? (item.release_date ? new Date(item.release_date).getFullYear() : undefined)
        : (item.first_air_date ? new Date(item.first_air_date).getFullYear() : undefined),
      description: item.overview,
      genres,
      inLibrary: this.library[`${type === 'movie' ? 'movie' : 'series'}:${id}`] !== undefined,
    };
  }

  /**
   * Get the current data source preference
   */
  async getDataSourcePreference(): Promise<DataSource> {
    try {
      const dataSource = await AsyncStorage.getItem(DATA_SOURCE_KEY);
      return dataSource as DataSource || DataSource.STREMIO_ADDONS;
    } catch (error) {
      logger.error('Failed to get data source preference:', error);
      return DataSource.STREMIO_ADDONS;
    }
  }

  /**
   * Set the data source preference
   */
  async setDataSourcePreference(dataSource: DataSource): Promise<void> {
    try {
      await AsyncStorage.setItem(DATA_SOURCE_KEY, dataSource);
    } catch (error) {
      logger.error('Failed to set data source preference:', error);
    }
  }

  async getContentDetails(type: string, id: string, preferredAddonId?: string): Promise<StreamingContent | null> {
    console.log(`🔍 [CatalogService] getContentDetails called:`, { type, id, preferredAddonId });
    try {
      // Try up to 2 times with increasing delays to reduce CPU load
      let meta = null;
      let lastError = null;
      
      for (let i = 0; i < 2; i++) {
        try {
          console.log(`🔍 [CatalogService] Attempt ${i + 1}/2 for getContentDetails:`, { type, id, preferredAddonId });
          
          // Skip meta requests for non-content ids (e.g., provider slugs)
          const isValidId = stremioService.isValidContentId(type, id);
          console.log(`🔍 [CatalogService] Content ID validation:`, { type, id, isValidId });
          
          if (!isValidId) {
            console.log(`🔍 [CatalogService] Invalid content ID, breaking retry loop`);
            break;
          }
          
          console.log(`🔍 [CatalogService] Calling stremioService.getMetaDetails:`, { type, id, preferredAddonId });
          meta = await stremioService.getMetaDetails(type, id, preferredAddonId);
          console.log(`🔍 [CatalogService] stremioService.getMetaDetails result:`, { 
            hasMeta: !!meta, 
            metaId: meta?.id, 
            metaName: meta?.name,
            metaType: meta?.type 
          });
          
          if (meta) break;
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
        } catch (error) {
          lastError = error;
          console.log(`🔍 [CatalogService] Attempt ${i + 1} failed:`, {
            errorMessage: error instanceof Error ? error.message : String(error),
            isAxiosError: (error as any)?.isAxiosError,
            responseStatus: (error as any)?.response?.status,
            responseData: (error as any)?.response?.data
          });
          logger.error(`Attempt ${i + 1} failed to get content details for ${type}:${id}:`, error);
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
        }
      }

      if (meta) {
        console.log(`🔍 [CatalogService] Meta found, converting to StreamingContent:`, { 
          metaId: meta.id, 
          metaName: meta.name, 
          metaType: meta.type 
        });
        
        // Add to recent content using enhanced conversion for full metadata
        const content = this.convertMetaToStreamingContentEnhanced(meta);
        this.addToRecentContent(content);
        
        // Check if it's in the library
        content.inLibrary = this.library[`${type}:${id}`] !== undefined;
        
        console.log(`🔍 [CatalogService] Successfully converted meta to StreamingContent:`, { 
          contentId: content.id, 
          contentName: content.name, 
          contentType: content.type,
          inLibrary: content.inLibrary
        });
        
        return content;
      }

      console.log(`🔍 [CatalogService] No meta found, checking lastError:`, { 
        hasLastError: !!lastError,
        lastErrorMessage: lastError instanceof Error ? lastError.message : String(lastError)
      });

      if (lastError) {
        console.log(`🔍 [CatalogService] Throwing lastError:`, {
          errorMessage: lastError instanceof Error ? lastError.message : String(lastError),
          isAxiosError: (lastError as any)?.isAxiosError,
          responseStatus: (lastError as any)?.response?.status
        });
        throw lastError;
      }
      
      console.log(`🔍 [CatalogService] No meta and no error, returning null`);
      return null;
    } catch (error) {
      console.log(`🔍 [CatalogService] getContentDetails caught error:`, {
        errorMessage: error instanceof Error ? error.message : String(error),
        isAxiosError: (error as any)?.isAxiosError,
        responseStatus: (error as any)?.response?.status,
        responseData: (error as any)?.response?.data
      });
      logger.error(`Failed to get content details for ${type}:${id}:`, error);
      return null;
    }
  }

  // Public method for getting enhanced metadata details (used by MetadataScreen)
  async getEnhancedContentDetails(type: string, id: string, preferredAddonId?: string): Promise<StreamingContent | null> {
    console.log(`🔍 [CatalogService] getEnhancedContentDetails called:`, { type, id, preferredAddonId });
    logger.log(`🔍 [MetadataScreen] Fetching enhanced metadata for ${type}:${id} ${preferredAddonId ? `from addon ${preferredAddonId}` : ''}`);
    
    try {
      const result = await this.getContentDetails(type, id, preferredAddonId);
      console.log(`🔍 [CatalogService] getEnhancedContentDetails result:`, { 
        hasResult: !!result, 
        resultId: result?.id, 
        resultName: result?.name,
        resultType: result?.type 
      });
      return result;
    } catch (error) {
      console.log(`🔍 [CatalogService] getEnhancedContentDetails error:`, {
        errorMessage: error instanceof Error ? error.message : String(error),
        isAxiosError: (error as any)?.isAxiosError,
        responseStatus: (error as any)?.response?.status,
        responseData: (error as any)?.response?.data
      });
      throw error;
    }
  }

  // Public method for getting basic content details without enhanced processing (used by ContinueWatching, etc.)
  async getBasicContentDetails(type: string, id: string, preferredAddonId?: string): Promise<StreamingContent | null> {
    try {
      // Try up to 3 times with increasing delays
      let meta = null;
      let lastError = null;
      
      for (let i = 0; i < 3; i++) {
        try {
          // Skip meta requests for non-content ids (e.g., provider slugs)
          if (!stremioService.isValidContentId(type, id)) {
            break;
          }
          meta = await stremioService.getMetaDetails(type, id, preferredAddonId);
          if (meta) break;
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
        } catch (error) {
          lastError = error;
          logger.error(`Attempt ${i + 1} failed to get basic content details for ${type}:${id}:`, error);
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
        }
      }

      if (meta) {
        // Use basic conversion without enhanced metadata processing
        const content = this.convertMetaToStreamingContent(meta);
        
        // Check if it's in the library
        content.inLibrary = this.library[`${type}:${id}`] !== undefined;
        
        return content;
      }

      if (lastError) {
        throw lastError;
      }
      
      return null;
    } catch (error) {
      logger.error(`Failed to get basic content details for ${type}:${id}:`, error);
      return null;
    }
  }

  private convertMetaToStreamingContent(meta: Meta): StreamingContent {
    // Basic conversion for catalog display - no enhanced metadata processing
    // Use addon's poster if available, otherwise use placeholder
    let posterUrl = meta.poster;
    if (!posterUrl || posterUrl.trim() === '' || posterUrl === 'null' || posterUrl === 'undefined') {
      posterUrl = 'https://via.placeholder.com/300x450/cccccc/666666?text=No+Image';
    }
    
    // Use addon's logo if available, otherwise undefined
    let logoUrl = (meta as any).logo;
    if (!logoUrl || logoUrl.trim() === '' || logoUrl === 'null' || logoUrl === 'undefined') {
      logoUrl = undefined;
    }
    try {
      logger.debug('[CatalogService] convertMetaToStreamingContent:logo', {
        id: meta.id,
        name: meta.name,
        hasLogo: Boolean(logoUrl),
        logo: logoUrl || undefined,
      });
    } catch {}
    
    return {
      id: meta.id,
      type: meta.type,
      name: meta.name,
      poster: posterUrl,
      posterShape: 'poster',
      banner: meta.background,
      logo: logoUrl,
      imdbRating: meta.imdbRating,
      year: meta.year,
      genres: meta.genres,
      description: meta.description,
      runtime: meta.runtime,
      inLibrary: this.library[`${meta.type}:${meta.id}`] !== undefined,
      certification: meta.certification,
      releaseInfo: meta.releaseInfo,
    };
  }

  // Enhanced conversion for detailed metadata (used only when fetching individual content details)
  private convertMetaToStreamingContentEnhanced(meta: Meta): StreamingContent {
    // Enhanced conversion to utilize all available metadata from addons
    const converted: StreamingContent = {
      id: meta.id,
      type: meta.type,
      name: meta.name,
      poster: meta.poster || 'https://via.placeholder.com/300x450/cccccc/666666?text=No+Image',
      posterShape: 'poster',
      banner: meta.background,
      // Use addon's logo if available, otherwise undefined
      logo: (meta as any).logo || undefined,
      imdbRating: meta.imdbRating,
      year: meta.year,
      genres: meta.genres,
      description: meta.description,
      runtime: meta.runtime,
      inLibrary: this.library[`${meta.type}:${meta.id}`] !== undefined,
      certification: meta.certification,
      // Enhanced fields from addon metadata
      directors: (meta as any).director ? 
        (Array.isArray((meta as any).director) ? (meta as any).director : [(meta as any).director]) 
        : undefined,
      writer: (meta as any).writer || undefined,
      country: (meta as any).country || undefined,
      imdb_id: (meta as any).imdb_id || undefined,
      slug: (meta as any).slug || undefined,
      releaseInfo: meta.releaseInfo || (meta as any).releaseInfo || undefined,
      trailerStreams: (meta as any).trailerStreams || undefined,
      links: (meta as any).links || undefined,
      behaviorHints: (meta as any).behaviorHints || undefined,
    };

    // Extract addon cast data if available
    // Check for both app_extras.cast (structured) and cast (simple array) formats
    if ((meta as any).app_extras?.cast && Array.isArray((meta as any).app_extras.cast)) {
      // Structured format with name, character, photo
      converted.addonCast = (meta as any).app_extras.cast.map((castMember: any, index: number) => ({
        id: index + 1, // Use index as numeric ID
        name: castMember.name || 'Unknown',
        character: castMember.character || '',
        profile_path: castMember.photo || null
      }));
    } else if (meta.cast && Array.isArray(meta.cast)) {
      // Simple array format with just names
      converted.addonCast = meta.cast.map((castName: string, index: number) => ({
        id: index + 1, // Use index as numeric ID
        name: castName || 'Unknown',
        character: '', // No character info available in simple format
        profile_path: null // No profile images available in simple format
      }));
    }

    // Log if rich metadata is found
    if ((meta as any).trailerStreams?.length > 0) {
      logger.log(`🎬 Enhanced metadata: Found ${(meta as any).trailerStreams.length} trailers for ${meta.name}`);
    }

    if ((meta as any).links?.length > 0) {
      logger.log(`🔗 Enhanced metadata: Found ${(meta as any).links.length} links for ${meta.name}`);
    }

    if (converted.addonCast && converted.addonCast.length > 0) {
      logger.log(`🎭 Enhanced metadata: Found ${converted.addonCast.length} cast members from addon for ${meta.name}`);
    }

    // Handle videos/episodes if available
    if ((meta as any).videos) {
      converted.videos = (meta as any).videos;
    }

    return converted;
  }

  private notifyLibrarySubscribers(): void {
    const items = Object.values(this.library);
    this.librarySubscribers.forEach(callback => callback(items));
  }

  public onLibraryAdd(listener: (item: StreamingContent) => void): () => void {
    this.libraryAddListeners.push(listener);
    return () => {
      this.libraryAddListeners = this.libraryAddListeners.filter(l => l !== listener);
    };
  }

  public onLibraryRemove(listener: (type: string, id: string) => void): () => void {
    this.libraryRemoveListeners.push(listener);
    return () => {
      this.libraryRemoveListeners = this.libraryRemoveListeners.filter(l => l !== listener);
    };
  }

  public getLibraryItems(): StreamingContent[] {
    return Object.values(this.library);
  }

  public subscribeToLibraryUpdates(callback: (items: StreamingContent[]) => void): () => void {
    this.librarySubscribers.push(callback);
    // Initial callback with current items
    callback(this.getLibraryItems());
    
    // Return unsubscribe function
    return () => {
      const index = this.librarySubscribers.indexOf(callback);
      if (index > -1) {
        this.librarySubscribers.splice(index, 1);
      }
    };
  }

  public async addToLibrary(content: StreamingContent): Promise<void> {
    const key = `${content.type}:${content.id}`;
    this.library[key] = content;
    this.saveLibrary();
    this.notifyLibrarySubscribers();
    try { this.libraryAddListeners.forEach(l => l(content)); } catch {}
    
    // Auto-setup notifications for series when added to library
    if (content.type === 'series') {
      try {
        await notificationService.updateNotificationsForSeries(content.id);
        console.log(`[CatalogService] Auto-setup notifications for series: ${content.name}`);
      } catch (error) {
        console.error(`[CatalogService] Failed to setup notifications for ${content.name}:`, error);
      }
    }
  }

  public async removeFromLibrary(type: string, id: string): Promise<void> {
    const key = `${type}:${id}`;
    delete this.library[key];
    this.saveLibrary();
    this.notifyLibrarySubscribers();
    try { this.libraryRemoveListeners.forEach(l => l(type, id)); } catch {}

    // Cancel notifications for series when removed from library
    if (type === 'series') {
      try {
        // Cancel all notifications for this series
        const scheduledNotifications = notificationService.getScheduledNotifications();
        const seriesToCancel = scheduledNotifications.filter(notification => notification.seriesId === id);
        for (const notification of seriesToCancel) {
          await notificationService.cancelNotification(notification.id);
        }
        console.log(`[CatalogService] Cancelled ${seriesToCancel.length} notifications for removed series: ${id}`);
      } catch (error) {
        console.error(`[CatalogService] Failed to cancel notifications for removed series ${id}:`, error);
      }
    }
  }

  private addToRecentContent(content: StreamingContent): void {
    // Remove if it already exists to prevent duplicates
    this.recentContent = this.recentContent.filter(item => 
      !(item.id === content.id && item.type === content.type)
    );
    
    // Add to the beginning of the array
    this.recentContent.unshift(content);
    
    // Trim the array if it exceeds the maximum
    if (this.recentContent.length > this.MAX_RECENT_ITEMS) {
      this.recentContent = this.recentContent.slice(0, this.MAX_RECENT_ITEMS);
    }
    
    this.saveRecentContent();
  }

  getRecentContent(): StreamingContent[] {
    return this.recentContent;
  }

  async searchContent(query: string): Promise<StreamingContent[]> {
    if (!query || query.trim().length < 2) {
      return [];
    }

    const addons = await this.getAllAddons();
    const results: StreamingContent[] = [];
    const searchPromises: Promise<void>[] = [];

    for (const addon of addons) {
      if (addon.catalogs && addon.catalogs.length > 0) {
        for (const catalog of addon.catalogs) {
          const addonManifest = await stremioService.getInstalledAddonsAsync();
          const manifest = addonManifest.find(a => a.id === addon.id);
          if (!manifest) continue;

          const searchPromise = (async () => {
            try {
              const filters = [{ title: 'search', value: query }];
              const metas = await stremioService.getCatalog(manifest, catalog.type, catalog.id, 1, filters);
              
              if (metas && metas.length > 0) {
                const items = metas.map(meta => this.convertMetaToStreamingContent(meta));
                results.push(...items);
              }
            } catch (error) {
              logger.error(`Search failed for ${catalog.id} in addon ${addon.id}:`, error);
            }
          })();
          
          searchPromises.push(searchPromise);
        }
      }
    }

    await Promise.all(searchPromises);

    // Remove duplicates based on id and type
    const uniqueResults = Array.from(
      new Map(results.map(item => [`${item.type}:${item.id}`, item])).values()
    );

    return uniqueResults;
  }

  /**
   * Search across all installed addons that support search functionality.
   * This dynamically queries any addon with catalogs that have 'search' in their extraSupported or extra fields.
   * Results are grouped by addon source with headers.
   * 
   * @param query - The search query string
   * @returns Promise<GroupedSearchResults> - Search results grouped by addon with headers
   */
  async searchContentCinemeta(query: string): Promise<GroupedSearchResults> {
    if (!query) {
      return { byAddon: [], allResults: [] };
    }

    const trimmedQuery = query.trim().toLowerCase();
    logger.log('Searching across all addons for:', trimmedQuery);

    const addons = await this.getAllAddons();
    const byAddon: AddonSearchResults[] = [];

    // Find all addons that support search
    const searchableAddons = addons.filter(addon => {
      if (!addon.catalogs) return false;
      
      // Check if any catalog supports search
      return addon.catalogs.some(catalog => {
        const extraSupported = catalog.extraSupported || [];
        const extra = catalog.extra || [];
        
        // Check if 'search' is in extraSupported or extra
        return extraSupported.includes('search') || 
               extra.some((e: any) => e.name === 'search');
      });
    });

    logger.log(`Found ${searchableAddons.length} searchable addons:`, searchableAddons.map(a => a.name).join(', '));

    // Search each addon and keep results grouped
    for (const addon of searchableAddons) {
      const searchableCatalogs = (addon.catalogs || []).filter(catalog => {
        const extraSupported = catalog.extraSupported || [];
        const extra = catalog.extra || [];
        return extraSupported.includes('search') || 
               extra.some((e: any) => e.name === 'search');
      });

      // Search all catalogs for this addon in parallel
      const catalogPromises = searchableCatalogs.map(catalog => 
        this.searchAddonCatalog(addon, catalog.type, catalog.id, trimmedQuery)
      );

      const catalogResults = await Promise.allSettled(catalogPromises);
      
      // Collect all results for this addon
      const addonResults: StreamingContent[] = [];
      catalogResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
          addonResults.push(...result.value);
        } else if (result.status === 'rejected') {
          logger.error(`Search failed for ${addon.name}:`, result.reason);
        }
      });

      // Only add addon section if it has results
      if (addonResults.length > 0) {
        // Deduplicate within this addon's results
        const seen = new Set<string>();
        const uniqueAddonResults = addonResults.filter(item => {
          const key = `${item.type}:${item.id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        byAddon.push({
          addonId: addon.id,
          addonName: addon.name,
          results: uniqueAddonResults,
        });
      }
    }

    // Create deduplicated flat list for backwards compatibility
    const allResults: StreamingContent[] = [];
    const globalSeen = new Set<string>();
    
    byAddon.forEach(addonGroup => {
      addonGroup.results.forEach(item => {
        const key = `${item.type}:${item.id}`;
        if (!globalSeen.has(key)) {
          globalSeen.add(key);
          allResults.push(item);
        }
      });
    });

    logger.log(`Search complete: ${byAddon.length} addons returned results, ${allResults.length} unique items total`);

    return { byAddon, allResults };
  }

  /**
   * Live search that emits results per-addon as they arrive.
   * Returns a handle with cancel() and a done promise.
   */
  startLiveSearch(
    query: string,
    onAddonResults: (section: AddonSearchResults) => void
  ): { cancel: () => void; done: Promise<void> } {
    const controller = { cancelled: false } as { cancelled: boolean };

    const done = (async () => {
      if (!query || !query.trim()) return;

      const trimmedQuery = query.trim().toLowerCase();
      logger.log('Live search across addons for:', trimmedQuery);

      const addons = await this.getAllAddons();

      // Determine searchable addons
      const searchableAddons = addons.filter(addon =>
        (addon.catalogs || []).some(c =>
          (c.extraSupported && c.extraSupported.includes('search')) ||
          (c.extra && c.extra.some(e => e.name === 'search'))
        )
      );

      // Global dedupe across emitted results
      const globalSeen = new Set<string>();

      await Promise.all(
        searchableAddons.map(async (addon) => {
          if (controller.cancelled) return;
          try {
            const searchableCatalogs = (addon.catalogs || []).filter(c =>
              (c.extraSupported && c.extraSupported.includes('search')) ||
              (c.extra && c.extra.some(e => e.name === 'search'))
            );

            // Fetch all catalogs for this addon in parallel
            const settled = await Promise.allSettled(
              searchableCatalogs.map(c => this.searchAddonCatalog(addon, c.type, c.id, trimmedQuery))
            );
            if (controller.cancelled) return;

            const addonResults: StreamingContent[] = [];
            for (const s of settled) {
              if (s.status === 'fulfilled' && Array.isArray(s.value)) {
                addonResults.push(...s.value);
              }
            }
            if (addonResults.length === 0) return;

            // Dedupe within addon and against global
            const localSeen = new Set<string>();
            const unique = addonResults.filter(item => {
              const key = `${item.type}:${item.id}`;
              if (localSeen.has(key) || globalSeen.has(key)) return false;
              localSeen.add(key);
              globalSeen.add(key);
              return true;
            });

            if (unique.length > 0 && !controller.cancelled) {
              onAddonResults({ addonId: addon.id, addonName: addon.name, results: unique });
            }
          } catch (e) {
            // ignore individual addon errors
          }
        })
      );
    })();

    return {
      cancel: () => { controller.cancelled = true; },
      done,
    };
  }

  /**
   * Search a specific catalog from a specific addon.
   * Handles URL construction for both Cinemeta (hardcoded) and other addons (dynamic).
   * 
   * @param addon - The addon manifest containing id, name, and url
   * @param type - Content type (movie, series, anime, etc.)
   * @param catalogId - The catalog ID to search within
   * @param query - The search query string
   * @returns Promise<StreamingContent[]> - Search results from this specific addon catalog
   */
  private async searchAddonCatalog(
    addon: any, 
    type: string, 
    catalogId: string, 
    query: string
  ): Promise<StreamingContent[]> {
    try {
      let url: string;
      
      // Special handling for Cinemeta (hardcoded URL)
      if (addon.id === 'com.linvo.cinemeta') {
        const encodedCatalogId = encodeURIComponent(catalogId);
        const encodedQuery = encodeURIComponent(query);
        url = `https://v3-cinemeta.strem.io/catalog/${type}/${encodedCatalogId}/search=${encodedQuery}.json`;
      } 
      // Handle other addons
      else {
        // Choose best available URL
        const chosenUrl: string | undefined = addon.url || addon.originalUrl || addon.transportUrl;
        if (!chosenUrl) {
          logger.warn(`Addon ${addon.name} has no URL, skipping search`);
          return [];
        }
        // Extract base URL and preserve query params
        const [baseUrlPart, queryParams] = chosenUrl.split('?');
        let cleanBaseUrl = baseUrlPart.replace(/manifest\.json$/, '').replace(/\/$/, '');
        
        // Ensure URL has protocol
        if (!cleanBaseUrl.startsWith('http')) {
          cleanBaseUrl = `https://${cleanBaseUrl}`;
        }
        
        const encodedCatalogId = encodeURIComponent(catalogId);
        const encodedQuery = encodeURIComponent(query);
        url = `${cleanBaseUrl}/catalog/${type}/${encodedCatalogId}/search=${encodedQuery}.json`;
        
        // Append original query params if they existed
        if (queryParams) {
          url += `?${queryParams}`;
        }
      }

      logger.log(`Searching ${addon.name} (${type}/${catalogId}):`, url);
      
      const response = await axios.get<{ metas: any[] }>(url, {
        timeout: 10000, // 10 second timeout per addon
      });
      
      const metas = response.data?.metas || [];
      
      if (metas.length > 0) {
        const items = metas.map(meta => this.convertMetaToStreamingContent(meta));
        logger.log(`Found ${items.length} results from ${addon.name}`);
        return items;
      }
      
      return [];
    } catch (error: any) {
      // Don't throw, just log and return empty
      const errorMsg = error?.response?.status 
        ? `HTTP ${error.response.status}` 
        : error?.message || 'Unknown error';
      logger.error(`Search failed for ${addon.name} (${type}/${catalogId}): ${errorMsg}`);
      return [];
    }
  }

  async getStremioId(type: string, tmdbId: string): Promise<string | null> {
    if (__DEV__) {
      console.log('=== CatalogService.getStremioId ===');
      console.log('Input type:', type);
      console.log('Input tmdbId:', tmdbId);
    }
    
    try {
      // For movies, use the tt prefix with IMDb ID
      if (type === 'movie') {
        if (__DEV__) console.log('Processing movie - fetching TMDB details...');
        const tmdbService = TMDBService.getInstance();
        const movieDetails = await tmdbService.getMovieDetails(tmdbId);
        
        if (__DEV__) console.log('Movie details result:', {
          id: movieDetails?.id,
          title: movieDetails?.title,
          imdb_id: movieDetails?.imdb_id,
          hasImdbId: !!movieDetails?.imdb_id
        });
        
        if (movieDetails?.imdb_id) {
          if (__DEV__) console.log('Successfully found IMDb ID:', movieDetails.imdb_id);
          return movieDetails.imdb_id;
        } else {
          console.warn('No IMDb ID found for movie:', tmdbId);
          return null;
        }
      }
      // For TV shows, get the IMDb ID like movies
      else if (type === 'tv' || type === 'series') {
        if (__DEV__) console.log('Processing TV show - fetching TMDB details for IMDb ID...');
        const tmdbService = TMDBService.getInstance();
        
        // Get TV show external IDs to find IMDb ID
        const externalIds = await tmdbService.getShowExternalIds(parseInt(tmdbId));
        
        if (__DEV__) console.log('TV show external IDs result:', {
          tmdbId: tmdbId,
          imdb_id: externalIds?.imdb_id,
          hasImdbId: !!externalIds?.imdb_id
        });
        
        if (externalIds?.imdb_id) {
          if (__DEV__) console.log('Successfully found IMDb ID for TV show:', externalIds.imdb_id);
          return externalIds.imdb_id;
        } else {
          console.warn('No IMDb ID found for TV show, falling back to kitsu format:', tmdbId);
          const fallbackId = `kitsu:${tmdbId}`;
          if (__DEV__) console.log('Generated fallback Stremio ID for TV:', fallbackId);
          return fallbackId;
        }
      }
      else {
        console.warn('Unknown type provided:', type);
        return null;
      }
    } catch (error: any) {
      if (__DEV__) {
        console.error('=== Error in getStremioId ===');
        console.error('Type:', type);
        console.error('TMDB ID:', tmdbId);
        console.error('Error details:', error);
        console.error('Error message:', error.message);
      }
      logger.error('Error getting Stremio ID:', error);
      return null;
    }
  }
}

export const catalogService = CatalogService.getInstance();
export default catalogService; 