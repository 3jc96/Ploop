import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, radius, spacing, typography } from '../theme';
import { DangerButton, NavBar } from '../components/ui';
import { useSOSContacts, SOSContact } from '../hooks/useSOSContacts';

type SOSScreenProps = { locationLabel?: string };

const NEEDS = [
  { id: 'tp', icon: '\ud83e\uddfb', label: 'Toilet Paper' },
  { id: 'emergency', icon: '\ud83d\udea8', label: 'Emergency' },
  { id: 'lost', icon: '\ud83d\uddfa\ufe0f', label: "I'm Lost" },
  { id: 'checkin', icon: '\ud83d\udcac', label: 'Just Check In' },
];

const AVATAR_COLORS = [colors.blue, colors.green, colors.gold, '#a855f7', '#ec4899'];

function NeedButton({
  icon,
  label,
  selected,
  onPress,
}: {
  icon: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.needBtn, selected && styles.needBtnSel]} onPress={onPress}>
      <Text style={styles.needIco}>{icon}</Text>
      <Text style={styles.needLbl}>{label}</Text>
    </Pressable>
  );
}

function ContactRow({
  contact,
  index,
  selected,
  onPress,
}: {
  contact: SOSContact;
  index: number;
  selected: boolean;
  onPress: () => void;
}) {
  const avatarColor = AVATAR_COLORS[index % AVATAR_COLORS.length];
  return (
    <Pressable style={styles.contact} onPress={onPress}>
      <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
        <Text style={styles.avatarText}>{contact.initials.slice(0, 1)}</Text>
      </View>
      <View style={styles.contactInfo}>
        <Text style={styles.cName} numberOfLines={1}>
          {contact.name}
        </Text>
        {contact.phone ? (
          <Text style={styles.cPhone} numberOfLines={1}>
            {contact.phone}
          </Text>
        ) : null}
      </View>
      <View style={[styles.check, selected && styles.checkSel]}>
        {selected ? <Text style={styles.checkMark}>{'\u2713'}</Text> : null}
      </View>
    </Pressable>
  );
}

export default function SOSScreen({ locationLabel = 'my location' }: SOSScreenProps) {
  const navigation = useNavigation<any>();
  const { contacts, loading, error, reload, permissionStatus } = useSOSContacts();
  const [need, setNeed] = useState(NEEDS[0].id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sent, setSent] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q)
    );
  }, [contacts, query]);

  const selected = contacts.find((c) => c.id === selectedId) ?? null;
  const needLabel = NEEDS.find((n) => n.id === need)?.label ?? 'help';

  const sendSOS = async () => {
    const target = selected
      ? `${selected.name}${selected.phone ? ` (${selected.phone})` : ''}`
      : 'a contact';
    const message = `Ploop SOS: I need "${needLabel}" near ${locationLabel}. Please check on me \u2014 ${target}.`;
    try {
      await Share.share({ message, title: 'Ploop SOS' });
      setSent(true);
      setTimeout(() => setSent(false), 2200);
    } catch {
      /* user dismissed share sheet */
    }
  };

  const callSelected = async () => {
    if (!selected?.phone) return;
    const url = `tel:${selected.phone.replace(/\s/g, '')}`;
    if (await Linking.canOpenURL(url)) await Linking.openURL(url);
  };

  const sendLabel = sent
    ? '\u2705 SOS Sent!'
    : selected
      ? `\ud83d\udccd Send SOS to ${selected.name.split(' ')[0]}`
      : '\ud83d\udccd Send SOS';

  return (
    <View style={styles.flex}>
      <NavBar title="Send SOS" onBack={() => navigation.goBack()} />
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <View>
          <View style={styles.sosIco}>
            <Text style={{ fontSize: 32 }}>{'\ud83c\udd98'}</Text>
          </View>
          <Text style={styles.sosH}>What do you need?</Text>
          <Text style={styles.sosSub}>Share your location and a message with someone you trust.</Text>
        </View>

        <View>
          <Text style={styles.secLbl}>I need\u2026</Text>
          <View style={styles.needGrid}>
            {NEEDS.map((n) => (
              <NeedButton
                key={n.id}
                icon={n.icon}
                label={n.label}
                selected={need === n.id}
                onPress={() => setNeed(n.id)}
              />
            ))}
          </View>
        </View>

        <View>
          <Text style={styles.secLbl}>Send to</Text>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={colors.red} />
              <Text style={styles.loadingText}>Loading contacts\u2026</Text>
            </View>
          ) : error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              {permissionStatus !== 'granted' ? (
                <Pressable style={styles.retry} onPress={reload}>
                  <Text style={styles.retryText}>Allow contacts</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <>
              {contacts.length > 6 ? (
                <TextInput
                  style={styles.search}
                  placeholder="Search contacts"
                  value={query}
                  onChangeText={setQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              ) : null}
              <View style={styles.contacts}>
                {filtered.length === 0 ? (
                  <Text style={styles.noContacts}>No contacts with phone numbers.</Text>
                ) : (
                  filtered
                    .slice(0, 50)
                    .map((c, i) => (
                      <ContactRow
                        key={c.id}
                        contact={c}
                        index={i}
                        selected={selectedId === c.id}
                        onPress={() => setSelectedId(c.id)}
                      />
                    ))
                )}
              </View>
            </>
          )}
        </View>

        {selected?.phone ? (
          <Pressable style={styles.callBtn} onPress={callSelected}>
            <Text style={styles.callBtnText}>{`\ud83d\udcde Call ${selected.name.split(' ')[0]}`}</Text>
          </Pressable>
        ) : null}

        <DangerButton label={sendLabel} filled onPress={sendSOS} style={sent ? styles.sentBtn : undefined} />
        <View style={{ height: spacing.lg }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, backgroundColor: colors.bg },
  bodyContent: { gap: 22, padding: spacing.lg },

  sosIco: {
    width: 68,
    height: 68,
    backgroundColor: colors.redLight,
    borderRadius: radius.xl + 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosH: { ...typography.largeTitle, color: colors.label, marginTop: 12 },
  sosSub: { fontSize: 15, color: colors.label2, lineHeight: 23, marginTop: 4 },

  secLbl: { ...typography.sectionLabel, color: colors.label2, marginBottom: 10 },

  needGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  needBtn: {
    width: '47.5%',
    flexGrow: 1,
    backgroundColor: colors.fill,
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderRadius: radius.xl,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  needBtnSel: { backgroundColor: colors.redLight, borderColor: colors.red },
  needIco: { fontSize: 26, marginBottom: 5 },
  needLbl: { fontSize: 13, fontWeight: '600', color: colors.label },

  search: {
    backgroundColor: colors.bg2,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
    fontSize: 15,
  },
  contacts: { backgroundColor: colors.bg2, borderRadius: radius.xl, overflow: 'hidden' },
  contact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 13,
    paddingVertical: 11,
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  contactInfo: { flex: 1, minWidth: 0 },
  cName: { fontSize: 15, fontWeight: '500', color: colors.label },
  cPhone: { fontSize: 13, color: colors.label2, marginTop: 1 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.separator,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSel: { backgroundColor: colors.blue, borderColor: colors.blue },
  checkMark: { color: colors.white, fontSize: 13, fontWeight: '700' },
  noContacts: { padding: spacing.lg, textAlign: 'center', color: colors.label3 },

  loadingBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: spacing.lg },
  loadingText: { color: colors.label2 },
  errorBox: { backgroundColor: colors.redLight, borderRadius: radius.lg, padding: spacing.md },
  errorText: { color: '#991b1b' },
  retry: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: colors.red,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  retryText: { color: colors.white, fontWeight: '600' },

  callBtn: {
    backgroundColor: colors.navy,
    borderRadius: radius.xl,
    padding: 15,
    alignItems: 'center',
  },
  callBtnText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  sentBtn: { backgroundColor: colors.green },
});
