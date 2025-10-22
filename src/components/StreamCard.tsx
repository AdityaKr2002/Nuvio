import React, { memo, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Clipboard,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import FastImage from '@d11/react-native-fast-image';
import { Stream } from '../types/metadata';
import QualityBadge from './metadata/QualityBadge';
import { useSettings } from '../hooks/useSettings';
import { useDownloads } from '../contexts/DownloadsContext';
import { useToast } from '../contexts/ToastContext';

interface StreamCardProps {
  stream: Stream;
  onPress: () => void;
  index: number;
  isLoading?: boolean;
  statusMessage?: string;
  theme: any;
  showLogos?: boolean;
  scraperLogo?: string | null;
  showAlert: (title: string, message: string) => void;
  parentTitle?: string;
  parentType?: 'movie' | 'series';
  parentSeason?: number;
  parentEpisode?: number;
  parentEpisodeTitle?: string;
  parentPosterUrl?: string | null;
  providerName?: string;
  parentId?: string;
  parentImdbId?: string;
}

const StreamCard = memo(({ 
  stream, 
  onPress, 
  index, 
  isLoading, 
  statusMessage, 
  theme, 
  showLogos, 
  scraperLogo, 
  showAlert, 
  parentTitle, 
  parentType, 
  parentSeason, 
  parentEpisode, 
  parentEpisodeTitle, 
  parentPosterUrl, 
  providerName, 
  parentId, 
  parentImdbId 
}: StreamCardProps) => {
  const { settings } = useSettings();
  const { startDownload } = useDownloads();
  const { showSuccess, showInfo } = useToast();
  
  // Handle long press to copy stream URL to clipboard
  const handleLongPress = useCallback(async () => {
    if (stream.url) {
      try {
        await Clipboard.setString(stream.url);
        
        // Use toast for Android, custom alert for iOS
        if (Platform.OS === 'android') {
          showSuccess('URL Copied', 'Stream URL copied to clipboard!');
        } else {
          // iOS uses custom alert
          showAlert('Copied!', 'Stream URL has been copied to clipboard.');
        }
      } catch (error) {
        // Fallback: show URL in alert if clipboard fails
        if (Platform.OS === 'android') {
          showInfo('Stream URL', `Stream URL: ${stream.url}`);
        } else {
          showAlert('Stream URL', stream.url);
        }
      }
    }
  }, [stream.url, showAlert, showSuccess, showInfo]);
  
  const styles = React.useMemo(() => createStyles(theme.colors), [theme.colors]);
  
  const streamInfo = useMemo(() => {
    const title = stream.title || '';
    const name = stream.name || '';
    
    // Helper function to format size from bytes
    const formatSize = (bytes: number): string => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };
    
    // Get size from title (legacy format) or from stream.size field
    let sizeDisplay = title.match(/💾\s*([\d.]+\s*[GM]B)/)?.[1];
    if (!sizeDisplay && stream.size && typeof stream.size === 'number' && stream.size > 0) {
      sizeDisplay = formatSize(stream.size);
    }
    
    // Extract quality for badge display
    const basicQuality = title.match(/(\d+)p/)?.[1] || null;
    
    return {
      quality: basicQuality,
      isHDR: title.toLowerCase().includes('hdr'),
      isDolby: title.toLowerCase().includes('dolby') || title.includes('DV'),
      size: sizeDisplay,
      isDebrid: stream.behaviorHints?.cached,
      displayName: name || 'Unnamed Stream',
      subTitle: title && title !== name ? title : null
    };
  }, [stream.name, stream.title, stream.behaviorHints, stream.size]);
  
  const handleDownload = useCallback(async () => {
    try {
      const url = stream.url;
      if (!url) return;
      // Prevent duplicate downloads for the same exact URL
      try {
        const downloadsModule = require('../contexts/DownloadsContext');
        if (downloadsModule && downloadsModule.isDownloadingUrl && downloadsModule.isDownloadingUrl(url)) {
          showAlert('Already Downloading', 'This download has already started for this exact link.');
          return;
        }
      } catch {}
      // Show immediate feedback on both platforms
      showAlert('Starting Download', 'Download will be started.');
      const parent: any = stream as any;
      const inferredTitle = parentTitle || stream.name || stream.title || parent.metaName || 'Content';
      const inferredType: 'movie' | 'series' = parentType || (parent.kind === 'series' || parent.type === 'series' ? 'series' : 'movie');
      const season = typeof parentSeason === 'number' ? parentSeason : (parent.season || parent.season_number);
      const episode = typeof parentEpisode === 'number' ? parentEpisode : (parent.episode || parent.episode_number);
      const episodeTitle = parentEpisodeTitle || parent.episodeTitle || parent.episode_name;
      // Prefer the stream's display name (often includes provider + resolution)
      const provider = (stream.name as any) || (stream.title as any) || providerName || parent.addonName || parent.addonId || (stream.addonName as any) || (stream.addonId as any) || 'Provider';
      
      // Use parentId first (from route params), fallback to stream metadata
      const idForContent = parentId || parent.imdbId || parent.tmdbId || parent.addonId || inferredTitle;
      
      // Extract tmdbId if available (from parentId or parent metadata)
      let tmdbId: number | undefined = undefined;
      if (parentId && parentId.startsWith('tmdb:')) {
        tmdbId = parseInt(parentId.split(':')[1], 10);
      } else if (typeof parent.tmdbId === 'number') {
        tmdbId = parent.tmdbId;
      }

      await startDownload({
        id: String(idForContent),
        type: inferredType,
        title: String(inferredTitle),
        providerName: String(provider),
        season: inferredType === 'series' ? (season ? Number(season) : undefined) : undefined,
        episode: inferredType === 'series' ? (episode ? Number(episode) : undefined) : undefined,
        episodeTitle: inferredType === 'series' ? (episodeTitle ? String(episodeTitle) : undefined) : undefined,
        quality: streamInfo.quality || undefined,
        posterUrl: parentPosterUrl || parent.poster || parent.backdrop || null,
        url,
        headers: (stream.headers as any) || undefined,
        // Pass metadata for progress tracking
        imdbId: parentImdbId || parent.imdbId || undefined,
        tmdbId: tmdbId,
      });
      showAlert('Download Started', 'Your download has been added to the queue.');
    } catch {}
  }, [startDownload, stream.url, stream.headers, streamInfo.quality, showAlert, stream.name, stream.title, parentId, parentImdbId, parentTitle, parentType, parentSeason, parentEpisode, parentEpisodeTitle, parentPosterUrl, providerName]);

  const isDebrid = streamInfo.isDebrid;
  return (
    <TouchableOpacity
        style={[
          styles.streamCard,
          isLoading && styles.streamCardLoading,
          isDebrid && styles.streamCardHighlighted
        ]}
        onPress={onPress}
        onLongPress={handleLongPress}
        disabled={isLoading}
        activeOpacity={0.7}
      >
        {/* Scraper Logo */}
        {showLogos && scraperLogo && (
          <View style={styles.scraperLogoContainer}>
            <FastImage
              source={{ uri: scraperLogo }}
              style={styles.scraperLogo}
              resizeMode={FastImage.resizeMode.contain}
            />
          </View>
        )}
        
        <View style={styles.streamDetails}>
          <View style={styles.streamNameRow}>
            <View style={styles.streamTitleContainer}>
              <Text style={[styles.streamName, { color: theme.colors.highEmphasis }]}>
                {streamInfo.displayName}
              </Text>
              {streamInfo.subTitle && (
                <Text style={[styles.streamAddonName, { color: theme.colors.mediumEmphasis }]}>
                  {streamInfo.subTitle}
                </Text>
              )}
            </View>
            
            {/* Show loading indicator if stream is loading */}
            {isLoading && (
              <View style={styles.loadingIndicator}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text style={[styles.loadingText, { color: theme.colors.primary }]}>
                  {statusMessage || "Loading..."}
                </Text>
              </View>
            )}
          </View>
          
          <View style={styles.streamMetaRow}>
            {streamInfo.isDolby && (
              <QualityBadge type="VISION" />
            )}
            
            {streamInfo.size && (
              <View style={[styles.chip, { backgroundColor: theme.colors.darkGray }]}>
                <Text style={[styles.chipText, { color: theme.colors.white }]}>💾 {streamInfo.size}</Text>
              </View>
            )}
            
            {streamInfo.isDebrid && (
              <View style={[styles.chip, { backgroundColor: theme.colors.success }]}>
                <Text style={[styles.chipText, { color: theme.colors.white }]}>DEBRID</Text>
              </View>
            )}
          </View>
        </View>
        
        
        {settings?.enableDownloads !== false && (
          <TouchableOpacity
            style={[styles.streamAction, { marginLeft: 8, backgroundColor: theme.colors.elevation2 }]}
            onPress={handleDownload}
            activeOpacity={0.7}
          >
            <MaterialIcons
              name="download"
              size={20}
              color={theme.colors.highEmphasis}
            />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
  );
});

const createStyles = (colors: any) => StyleSheet.create({
  streamCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    minHeight: 68,
    backgroundColor: colors.card,
    borderWidth: 0,
    width: '100%',
    zIndex: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 0,
  },
  scraperLogoContainer: {
    width: 32,
    height: 32,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.elevation2,
    borderRadius: 6,
  },
  scraperLogo: {
    width: 24,
    height: 24,
  },
  streamCardLoading: {
    opacity: 0.7,
  },
  streamCardHighlighted: {
    backgroundColor: colors.elevation2,
    shadowOpacity: 0.18,
  },
  streamDetails: {
    flex: 1,
  },
  streamNameRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    width: '100%',
    flexWrap: 'wrap',
    gap: 8
  },
  streamTitleContainer: {
    flex: 1,
  },
  streamName: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
    lineHeight: 20,
    color: colors.highEmphasis,
    letterSpacing: 0.1,
  },
  streamAddonName: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.mediumEmphasis,
    marginBottom: 6,
  },
  streamMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 6,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    marginRight: 6,
    marginBottom: 6,
    backgroundColor: colors.elevation2,
  },
  chipText: {
    color: colors.highEmphasis,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  loadingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 8,
  },
  loadingText: {
    color: colors.primary,
    fontSize: 12,
    marginLeft: 4,
    fontWeight: '500',
  },
  streamAction: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default StreamCard;
