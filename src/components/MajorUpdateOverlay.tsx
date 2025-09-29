import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';

interface Props {
  visible: boolean;
  latestTag?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  onDismiss: () => void;
  onLater: () => void;
}

const MajorUpdateOverlay: React.FC<Props> = ({ visible, latestTag, releaseNotes, releaseUrl, onDismiss, onLater }) => {
  const { currentTheme } = useTheme();

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent presentationStyle="overFullScreen">
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: currentTheme.colors.darkBackground, borderColor: currentTheme.colors.elevation3 }]}>          
          <View style={styles.header}>
            <View style={[styles.iconCircle, { backgroundColor: `${currentTheme.colors.primary}22` }]}>
              <MaterialIcons name="new-releases" size={28} color={currentTheme.colors.primary} />
            </View>
            <Text style={[styles.title, { color: currentTheme.colors.highEmphasis }]}>Major update available</Text>
            {!!latestTag && (
              <Text style={[styles.version, { color: currentTheme.colors.mediumEmphasis }]}>Latest: {latestTag}</Text>
            )}
          </View>

          {!!releaseNotes && (
            <View style={styles.notesBox}>
              <Text style={[styles.notes, { color: currentTheme.colors.mediumEmphasis }]} numberOfLines={10}>
                {releaseNotes}
              </Text>
            </View>
          )}

          <View style={styles.actions}>
            {releaseUrl ? (
              <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: currentTheme.colors.primary }]} onPress={() => Linking.openURL(releaseUrl)}>
                <MaterialIcons name="open-in-new" size={18} color="#fff" />
                <Text style={styles.primaryText}>View release</Text>
              </TouchableOpacity>
            ) : null}

            <View style={styles.secondaryRow}>
              <TouchableOpacity style={[styles.secondaryBtn, { borderColor: currentTheme.colors.elevation3 }]} onPress={onLater}>
                <Text style={[styles.secondaryText, { color: currentTheme.colors.mediumEmphasis }]}>Later</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.secondaryBtn, { borderColor: currentTheme.colors.elevation3 }]} onPress={onDismiss}>
                <Text style={[styles.secondaryText, { color: currentTheme.colors.mediumEmphasis }]}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: 380, maxWidth: '100%', borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  header: { alignItems: 'center', paddingTop: 28, paddingBottom: 16, paddingHorizontal: 20 },
  iconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 6 },
  version: { fontSize: 14 },
  notesBox: { marginHorizontal: 20, marginBottom: 16, padding: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)' },
  notes: { fontSize: 14, lineHeight: 20 },
  actions: { paddingHorizontal: 20, paddingBottom: 20 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', paddingVertical: 12, borderRadius: 12, marginBottom: 12 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryRow: { flexDirection: 'row', gap: 10 },
  secondaryBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  secondaryText: { fontSize: 15, fontWeight: '500' },
});

export default MajorUpdateOverlay;


