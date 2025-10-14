import React, { useCallback, useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Dimensions,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  Alert,
  Platform,
  Clipboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../contexts/ThemeContext';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import { NavigationProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import { LinearGradient } from 'expo-linear-gradient';
import FastImage from '@d11/react-native-fast-image';
import { useDownloads } from '../contexts/DownloadsContext';
import type { DownloadItem } from '../contexts/DownloadsContext';
import { Toast } from 'toastify-react-native';
import CustomAlert from '../components/CustomAlert';

const { height, width } = Dimensions.get('window');
const isTablet = width >= 768;

// Tablet-optimized poster sizes
const HORIZONTAL_ITEM_WIDTH = isTablet ? width * 0.18 : width * 0.3;
const HORIZONTAL_POSTER_HEIGHT = HORIZONTAL_ITEM_WIDTH * 1.5;
const POSTER_WIDTH = isTablet ? 70 : 90;
const POSTER_HEIGHT = isTablet ? 105 : 135;

// Helper function to optimize poster URLs
const optimizePosterUrl = (poster: string | undefined | null): string => {
  if (!poster || poster.includes('placeholder')) {
    return 'https://via.placeholder.com/80x120/333333/666666?text=No+Image';
  }

  // For TMDB images, use larger sizes for bigger posters
  if (poster.includes('image.tmdb.org')) {
    return poster.replace(/\/w\d+\//, '/w300/');
  }

  return poster;
};

// Download items come from DownloadsContext

// Empty state component
const EmptyDownloadsState: React.FC<{ navigation: NavigationProp<RootStackParamList> }> = ({ navigation }) => {
  const { currentTheme } = useTheme();
  
  return (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIconContainer, { backgroundColor: currentTheme.colors.elevation1 }]}>
        <MaterialCommunityIcons
          name="download-outline"
          size={48}
          color={currentTheme.colors.mediumEmphasis}
        />
      </View>
      <Text style={[styles.emptyTitle, { color: currentTheme.colors.text }]}>
        No Downloads Yet
      </Text>
      <Text style={[styles.emptySubtitle, { color: currentTheme.colors.mediumEmphasis }]}>
        Downloaded content will appear here for offline viewing
      </Text>
      <TouchableOpacity 
        style={[styles.exploreButton, { backgroundColor: currentTheme.colors.primary }]}
        onPress={() => {
          navigation.navigate('Search');
        }}
      >
        <Text style={[styles.exploreButtonText, { color: currentTheme.colors.background }]}>
          Explore Content
        </Text>
      </TouchableOpacity>
    </View>
  );
};

// Download item component
const DownloadItemComponent: React.FC<{
  item: DownloadItem;
  onPress: (item: DownloadItem) => void;
  onAction: (item: DownloadItem, action: 'pause' | 'resume' | 'cancel' | 'retry') => void;
  onRequestRemove: (item: DownloadItem) => void;
}> = React.memo(({ item, onPress, onAction, onRequestRemove }) => {
  const { currentTheme } = useTheme();
  const [posterUrl, setPosterUrl] = useState<string | null>(item.posterUrl || null);

  // Try to fetch poster if not available
  useEffect(() => {
    if (!posterUrl && (item.imdbId || item.tmdbId)) {
      // This could be enhanced to fetch poster from TMDB API if needed
      // For now, we'll use the existing posterUrl or fallback to placeholder
      setPosterUrl(item.posterUrl || null);
    }
  }, [item.imdbId, item.tmdbId, item.posterUrl, posterUrl]);

  const handleLongPress = useCallback(() => {
    if (item.status === 'completed' && item.fileUri) {
      Clipboard.setString(item.fileUri);
      if (Platform.OS === 'android') {
        Toast.success('Local file path copied to clipboard');
      } else {
        Alert.alert('Copied', 'Local file path copied to clipboard');
      }
    } else if (item.status !== 'completed') {
      if (Platform.OS === 'android') {
        Toast.info('Download is not complete yet');
      } else {
        Alert.alert('Not Available', 'The local file path is available only after the download is complete.');
      }
    }
  }, [item.status, item.fileUri]);

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '0 B';
    const sizes = ['B','KB','MB','GB','TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const v = bytes / Math.pow(1024, i);
    return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${sizes[i]}`;
  };
  
  const getStatusColor = () => {
    switch (item.status) {
      case 'downloading':
        return currentTheme.colors.primary;
      case 'completed':
        return currentTheme.colors.success || '#4CAF50';
      case 'paused':
        return currentTheme.colors.warning || '#FF9500';
      case 'error':
        return currentTheme.colors.error || '#FF3B30';
      case 'queued':
        return currentTheme.colors.mediumEmphasis;
      default:
        return currentTheme.colors.mediumEmphasis;
    }
  };

  const getStatusText = () => {
    switch (item.status) {
      case 'downloading':
        const eta = item.etaSeconds ? `${Math.ceil(item.etaSeconds / 60)}m` : undefined;
        return eta ? `Downloading • ${eta}` : 'Downloading';
      case 'completed':
        return 'Completed';
      case 'paused':
        return 'Paused';
      case 'error':
        return 'Error';
      case 'queued':
        return 'Queued';
      default:
        return 'Unknown';
    }
  };

  const getActionIcon = () => {
    switch (item.status) {
      case 'downloading':
        return 'pause';
      case 'paused':
      case 'error':
        return 'play';
      case 'queued':
        return 'play';
      default:
        return null;
    }
  };

  const handleActionPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    switch (item.status) {
      case 'downloading':
        onAction(item, 'pause');
        break;
      case 'paused':
      case 'error':
      case 'queued':
        onAction(item, 'resume');
        break;
    }
  };

  return (
    <TouchableOpacity
      style={[styles.downloadItem, { backgroundColor: currentTheme.colors.elevation2 }]}
      onPress={() => onPress(item)}
      onLongPress={handleLongPress}
      activeOpacity={0.8}
    >
      {/* Poster */}
      <View style={styles.posterContainer}>
        <FastImage
          source={{ uri: optimizePosterUrl(posterUrl) }}
          style={styles.poster}
          resizeMode={FastImage.resizeMode.cover}
        />
        {/* Status indicator overlay */}
        <View style={[styles.statusOverlay, { backgroundColor: getStatusColor() }]}>
          <MaterialCommunityIcons
            name={
              item.status === 'completed' ? 'check' :
              item.status === 'downloading' ? 'download' :
              item.status === 'paused' ? 'pause' :
              item.status === 'error' ? 'alert-circle' :
              'clock'
            }
            size={12}
            color="white"
          />
        </View>
      </View>

      {/* Content info */}
      <View style={styles.downloadContent}>
        <View style={styles.downloadHeader}>
          <View style={styles.titleContainer}>
            <Text style={[styles.downloadTitle, { color: currentTheme.colors.text }]} numberOfLines={1}>
              {item.title}{item.type === 'series' && item.season && item.episode ? `  S${String(item.season).padStart(2,'0')}E${String(item.episode).padStart(2,'0')}` : ''}
            </Text>
          </View>
          
          {item.type === 'series' && (
            <Text style={[styles.episodeInfo, { color: currentTheme.colors.mediumEmphasis }]} numberOfLines={1}>
              S{item.season?.toString().padStart(2, '0')}E{item.episode?.toString().padStart(2, '0')} • {item.episodeTitle}
            </Text>
          )}
        </View>

        {/* Progress section */}
        <View style={styles.progressSection}>
          {/* Provider + quality row */}
          <View style={styles.providerRow}>
            <Text style={[styles.providerText, { color: currentTheme.colors.mediumEmphasis }]}>
              {item.providerName || 'Provider'}
            </Text>
          </View>
          {/* Status row */}
          <View style={styles.statusRow}>
            <Text style={[styles.statusText, { color: getStatusColor() }]}>
              {getStatusText()}
            </Text>
          </View>

          {/* Size row */}
          <View style={styles.sizeRow}>
            <Text style={[styles.progressText, { color: currentTheme.colors.mediumEmphasis }]}>
              {formatBytes(item.downloadedBytes)} / {item.totalBytes ? formatBytes(item.totalBytes) : '—'}
            </Text>
          </View>

          {/* Warning for small files */}
          {item.totalBytes && item.totalBytes < 1048576 && ( // Less than 1MB
            <View style={styles.warningRow}>
              <MaterialCommunityIcons
                name="alert-circle"
                size={14}
                color={currentTheme.colors.warning || '#FF9500'}
              />
              <Text style={[styles.warningText, { color: currentTheme.colors.warning || '#FF9500' }]}>
                May not play - streaming playlist
              </Text>
            </View>
          )}

          {/* Progress bar */}
          <View style={[styles.progressContainer, { backgroundColor: currentTheme.colors.elevation1 }]}>
            <Animated.View
              style={[
                styles.progressBar,
                {
                  backgroundColor: getStatusColor(),
                  width: `${item.progress || 0}%`,
                },
              ]}
            />
          </View>
          
          <View style={styles.progressDetails}>
            <Text style={[styles.progressPercentage, { color: currentTheme.colors.text }]}>
              {item.progress || 0}%
            </Text>
            {item.etaSeconds && item.status === 'downloading' && (
              <Text style={[styles.etaText, { color: currentTheme.colors.mediumEmphasis }]}>
                {Math.ceil(item.etaSeconds / 60)}m remaining
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actionContainer}>
        {getActionIcon() && (
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: currentTheme.colors.elevation2 }]}
            onPress={handleActionPress}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name={getActionIcon() as any}
              size={20}
              color={currentTheme.colors.primary}
            />
          </TouchableOpacity>
        )}
        
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: currentTheme.colors.elevation2 }]}
          onPress={() => onRequestRemove(item)}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="delete-outline"
            size={20}
            color={currentTheme.colors.error}
          />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
});

const DownloadsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { currentTheme } = useTheme();
  const { top: safeAreaTop } = useSafeAreaInsets();
  const { downloads, pauseDownload, resumeDownload, cancelDownload } = useDownloads();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'downloading' | 'completed' | 'paused'>('all');
  const [showHelpAlert, setShowHelpAlert] = useState(false);
  const [showRemoveAlert, setShowRemoveAlert] = useState(false);
  const [pendingRemoveItem, setPendingRemoveItem] = useState<DownloadItem | null>(null);

  // Animation values
  const headerOpacity = useSharedValue(1);

  // Filter downloads based on selected filter
  const filteredDownloads = useMemo(() => {
    if (selectedFilter === 'all') return downloads;
    return downloads.filter(item => {
      switch (selectedFilter) {
        case 'downloading':
          return item.status === 'downloading' || item.status === 'queued';
        case 'completed':
          return item.status === 'completed';
        case 'paused':
          return item.status === 'paused' || item.status === 'error';
        default:
          return true;
      }
    });
  }, [downloads, selectedFilter]);

  // Statistics
  const stats = useMemo(() => {
    const total = downloads.length;
    const downloading = downloads.filter(item =>
      item.status === 'downloading' || item.status === 'queued'
    ).length;
    const completed = downloads.filter(item => item.status === 'completed').length;
    const paused = downloads.filter(item =>
      item.status === 'paused' || item.status === 'error'
    ).length;

    return { total, downloading, completed, paused };
  }, [downloads]);

  // Handlers
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    // In a real app, this would refresh the downloads from the service
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsRefreshing(false);
  }, []);

  const handleDownloadPress = useCallback((item: DownloadItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (item.status !== 'completed') {
      Alert.alert('Download not ready', 'Please wait until the download completes.');
      return;
    }
    const uri = (item as any).fileUri || (item as any).sourceUrl;
    if (!uri) return;

    // Infer videoType and mkv
    const lower = String(uri).toLowerCase();
    const isMkv = /\.mkv(\?|$)/i.test(lower) || /(?:[?&]ext=|container=|format=)mkv\b/i.test(lower);
    const isM3u8 = /\.m3u8(\?|$)/i.test(lower);
    const isMpd = /\.mpd(\?|$)/i.test(lower);
    const isMp4 = /\.mp4(\?|$)/i.test(lower);
    const videoType = isM3u8 ? 'm3u8' : isMpd ? 'mpd' : isMp4 ? 'mp4' : undefined;

    // Build episodeId for series progress tracking (format: contentId:season:episode)
    const episodeId = item.type === 'series' && item.season && item.episode
      ? `${item.contentId}:${item.season}:${item.episode}`
      : undefined;

    const playerRoute = Platform.OS === 'ios' ? 'PlayerIOS' : 'PlayerAndroid';
    navigation.navigate(playerRoute as any, {
      uri,
      title: item.title,
      episodeTitle: item.type === 'series' ? item.episodeTitle : undefined,
      season: item.type === 'series' ? item.season : undefined,
      episode: item.type === 'series' ? item.episode : undefined,
      quality: item.quality,
      year: undefined,
      streamProvider: 'Downloads',
      streamName: item.providerName || 'Offline',
      headers: undefined,
      forceVlc: Platform.OS === 'android' ? isMkv : false,
      id: item.contentId, // Use contentId (base ID) instead of compound id for progress tracking
      type: item.type,
      episodeId: episodeId, // Pass episodeId for series progress tracking
      imdbId: (item as any).imdbId || item.contentId, // Use imdbId if available, fallback to contentId
      availableStreams: {},
      backdrop: undefined,
      videoType,
    } as any);
  }, [navigation]);

  const handleDownloadAction = useCallback((item: DownloadItem, action: 'pause' | 'resume' | 'cancel' | 'retry') => {
    if (action === 'pause') pauseDownload(item.id);
    if (action === 'resume') resumeDownload(item.id);
    if (action === 'cancel') cancelDownload(item.id);
  }, [pauseDownload, resumeDownload, cancelDownload]);

  const handleRequestRemove = useCallback((item: DownloadItem) => {
    setPendingRemoveItem(item);
    setShowRemoveAlert(true);
  }, []);

  const handleFilterPress = useCallback((filter: 'all' | 'downloading' | 'completed' | 'paused') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedFilter(filter);
  }, []);

  const showDownloadHelp = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowHelpAlert(true);
  }, []);

  // Focus effect
  useFocusEffect(
    useCallback(() => {
      // In a real app, this would load downloads from the service
      // For now, we'll just show empty state
    }, [])
  );

  // Animated styles
  const headerStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
  }));

  const renderFilterButton = (filter: typeof selectedFilter, label: string, count: number) => (
    <TouchableOpacity
      key={filter}
      style={[
        styles.filterButton,
        {
          backgroundColor: selectedFilter === filter 
            ? currentTheme.colors.primary 
            : currentTheme.colors.elevation1,
        }
      ]}
      onPress={() => handleFilterPress(filter)}
      activeOpacity={0.8}
    >
      <Text style={[
        styles.filterButtonText,
        {
          color: selectedFilter === filter 
            ? currentTheme.colors.white 
            : currentTheme.colors.text,
        }
      ]}>
        {label}
      </Text>
      {count > 0 && (
        <View style={[
          styles.filterBadge,
          {
            backgroundColor: selectedFilter === filter 
              ? currentTheme.colors.white 
              : currentTheme.colors.primary,
          }
        ]}>
          <Text style={[
            styles.filterBadgeText,
            {
              color: selectedFilter === filter 
                ? currentTheme.colors.primary 
                : currentTheme.colors.white,
            }
          ]}>
            {count}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: currentTheme.colors.darkBackground }]}>
      <StatusBar
        translucent
        barStyle="light-content"
        backgroundColor="transparent"
      />

      {/* Header */}
      <Animated.View style={[
        styles.header,
        {
          backgroundColor: currentTheme.colors.darkBackground,
          paddingTop: (Platform.OS === 'android' 
            ? (StatusBar.currentHeight || 0) + 26 
            : safeAreaTop + 15) + (isTablet ? 64 : 0),
          borderBottomColor: currentTheme.colors.border,
        },
        headerStyle,
      ]}>
        <View style={styles.headerTitleRow}>
          <Text style={[styles.headerTitle, { color: currentTheme.colors.text }]}>
            Downloads
          </Text>
          <TouchableOpacity
            style={styles.helpButton}
            onPress={showDownloadHelp}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="help-circle-outline"
              size={24}
              color={currentTheme.colors.mediumEmphasis}
            />
          </TouchableOpacity>
        </View>
        
        {downloads.length > 0 && (
          <View style={styles.filterContainer}>
            {renderFilterButton('all', 'All', stats.total)}
            {renderFilterButton('downloading', 'Active', stats.downloading)}
            {renderFilterButton('completed', 'Done', stats.completed)}
            {renderFilterButton('paused', 'Paused', stats.paused)}
          </View>
        )}
      </Animated.View>

      {/* Content */}
      {downloads.length === 0 ? (
        <EmptyDownloadsState navigation={navigation} />
      ) : (
        <FlatList
          data={filteredDownloads}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <DownloadItemComponent
              item={item}
              onPress={handleDownloadPress}
              onAction={handleDownloadAction}
              onRequestRemove={handleRequestRemove}
            />
          )}
          style={{ backgroundColor: currentTheme.colors.darkBackground }}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={currentTheme.colors.primary}
              colors={[currentTheme.colors.primary]}
            />
          }
          ListEmptyComponent={() => (
            <View style={styles.emptyFilterContainer}>
              <MaterialCommunityIcons
                name="filter-off"
                size={48}
                color={currentTheme.colors.mediumEmphasis}
              />
              <Text style={[styles.emptyFilterTitle, { color: currentTheme.colors.text }]}>
                No {selectedFilter} downloads
              </Text>
              <Text style={[styles.emptyFilterSubtitle, { color: currentTheme.colors.mediumEmphasis }]}>
                Try selecting a different filter
              </Text>
            </View>
          )}
        />
      )}

      {/* Help Alert */}
      <CustomAlert
        visible={showHelpAlert}
        title="Download Limitations"
        message="• Files smaller than 1MB are typically M3U8 streaming playlists and cannot be downloaded for offline viewing. These only work with online streaming and contain links to video segments, not the actual video content."
        onClose={() => setShowHelpAlert(false)}
      />

      {/* Remove Download Confirmation */}
      <CustomAlert
        visible={showRemoveAlert}
        title="Remove Download"
        message={pendingRemoveItem ? `Remove \"${pendingRemoveItem.title}\"${pendingRemoveItem.type === 'series' && pendingRemoveItem.season && pendingRemoveItem.episode ? ` S${String(pendingRemoveItem.season).padStart(2,'0')}E${String(pendingRemoveItem.episode).padStart(2,'0')}` : ''}?` : 'Remove this download?'}
        actions={[
          { label: 'Cancel', onPress: () => setShowRemoveAlert(false) },
          { label: 'Remove', onPress: () => { if (pendingRemoveItem) { cancelDownload(pendingRemoveItem.id); } setShowRemoveAlert(false); setPendingRemoveItem(null); }, style: { } },
        ]}
        onClose={() => { setShowRemoveAlert(false); setPendingRemoveItem(null); }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: isTablet ? 24 : Math.max(1, width * 0.05),
    paddingBottom: isTablet ? 20 : 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: isTablet ? 20 : 16,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: isTablet ? 36 : Math.min(32, width * 0.08),
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  helpButton: {
    padding: 8,
    marginLeft: 8,
  },
  filterContainer: {
    flexDirection: 'row',
    gap: isTablet ? 16 : 12,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: isTablet ? 20 : 16,
    paddingVertical: isTablet ? 10 : 8,
    borderRadius: 20,
    gap: 8,
  },
  filterButtonText: {
    fontSize: isTablet ? 16 : 14,
    fontWeight: '600',
  },
  filterBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  filterBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  listContainer: {
    paddingHorizontal: 0,
    paddingTop: 8,
    paddingBottom: isTablet ? 120 : 100, // Extra padding for tablet bottom nav
  },
  downloadItem: {
    borderRadius: 16,
    padding: isTablet ? 20 : 16,
    marginBottom: isTablet ? 16 : 12,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: isTablet ? 165 : 152, // Accommodate tablet poster + padding
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    marginHorizontal: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  posterContainer: {
    width: POSTER_WIDTH,
    height: POSTER_HEIGHT,
    borderRadius: 8,
    marginRight: isTablet ? 20 : 16,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#333',
  },
  poster: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  statusOverlay: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 2,
  },
  downloadContent: {
    flex: 1,
  },
  downloadHeader: {
    marginBottom: 12,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  downloadTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  qualityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  qualityText: {
    fontSize: 12,
    fontWeight: '700',
  },
  episodeInfo: {
    fontSize: 14,
    fontWeight: '500',
  },
  progressSection: {
    gap: 4,
  },
  providerRow: {
    marginBottom: 2,
  },
  providerText: {
    fontSize: 12,
    fontWeight: '500',
  },
  statusRow: {
    marginBottom: 2,
  },
  sizeRow: {
    marginBottom: 6,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  warningText: {
    fontSize: 11,
    fontWeight: '500',
  },
  progressInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
  },
  progressText: {
    fontSize: 12,
    fontWeight: '500',
  },
  progressContainer: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 2,
  },
  progressDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressPercentage: {
    fontSize: 14,
    fontWeight: '700',
  },
  etaText: {
    fontSize: 12,
    fontWeight: '500',
  },
  actionContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: isTablet ? 64 : 40,
    paddingBottom: isTablet ? 120 : 100,
  },
  emptyIconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: isTablet ? 28 : 24,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: isTablet ? 18 : 16,
    textAlign: 'center',
    lineHeight: isTablet ? 28 : 24,
    marginBottom: isTablet ? 40 : 32,
  },
  exploreButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  exploreButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  emptyFilterContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: isTablet ? 80 : 60,
  },
  emptyFilterTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyFilterSubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
});

export default DownloadsScreen;