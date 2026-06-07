import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSOSContacts, SOSContact } from '../hooks/useSOSContacts';

const SOS_NEEDS = [
  { id: 'tp', label: 'Toilet paper' },
  { id: 'soap', label: 'Hand soap' },
  { id: 'stall', label: 'Stall occupied too long' },
  { id: 'help', label: 'Need help' },
];

type SOSScreenProps = {
  locationLabel?: string;
};

function ContactRow({
  contact,
  selected,
  onPress,
}: {
  contact: SOSContact;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.contactRow, selected && styles.contactRowSelected]} onPress={onPress}>
      <View style={styles.contactAvatar}>
        <Text style={styles.contactAvatarText}>{contact.initials}</Text>
      </View>
      <View style={styles.contactInfo}>
        <Text style={styles.contactName}>{contact.name}</Text>
        <Text style={styles.contactPhone}>{contact.phone ?? 'No phone number'}</Text>
      </View>
    </Pressable>
  );
}

export default function SOSScreen({ locationLabel = 'my location' }: SOSScreenProps) {
  const { contacts, loading, error, reload, permissionStatus } = useSOSContacts();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedNeed, setSelectedNeed] = useState(SOS_NEEDS[0].id);

  const filteredContacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q)
    );
  }, [contacts, query]);

  const selectedContact = contacts.find((c) => c.id === selectedId) ?? null;
  const needLabel = SOS_NEEDS.find((n) => n.id === selectedNeed)?.label ?? 'help';

  const sendSOS = async () => {
    const contactLine = selectedContact
      ? `${selectedContact.name}${selectedContact.phone ? ` (${selectedContact.phone})` : ''}`
      : 'a contact';
    const message = `Ploop SOS: I need ${needLabel} near ${locationLabel}. Please check on me — ${contactLine}.`;
    await Share.share({ message, title: 'Ploop SOS' });
  };

  const callContact = async () => {
    if (!selectedContact?.phone) return;
    const url = `tel:${selectedContact.phone.replace(/\s/g, '')}`;
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) await Linking.openURL(url);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#dc2626" />
        <Text style={styles.loadingText}>Loading contacts…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>SOS</Text>
      <Text style={styles.subtitle}>Pick a contact from your phone and what you need.</Text>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          {permissionStatus !== 'granted' ? (
            <Pressable style={styles.retryButton} onPress={reload}>
              <Text style={styles.retryText}>Allow contacts</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <TextInput
        style={styles.search}
        placeholder="Search contacts"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={styles.needsRow}>
        {SOS_NEEDS.map((need) => (
          <Pressable
            key={need.id}
            style={[styles.needChip, selectedNeed === need.id && styles.needChipSelected]}
            onPress={() => setSelectedNeed(need.id)}
          >
            <Text style={[styles.needChipText, selectedNeed === need.id && styles.needChipTextSelected]}>
              {need.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={filteredContacts}
        keyExtractor={(item) => item.id}
        style={styles.list}
        renderItem={({ item }) => (
          <ContactRow
            contact={item}
            selected={item.id === selectedId}
            onPress={() => setSelectedId(item.id)}
          />
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {permissionStatus === 'granted' ? 'No contacts with phone numbers found.' : 'Contacts not available.'}
          </Text>
        }
      />

      <View style={styles.actions}>
        <Pressable style={[styles.actionButton, styles.callButton]} onPress={callContact} disabled={!selectedContact?.phone}>
          <Text style={styles.actionButtonText}>Call</Text>
        </Pressable>
        <Pressable style={[styles.actionButton, styles.shareButton]} onPress={sendSOS}>
          <Text style={styles.actionButtonText}>Share SOS</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff7f7',
    gap: 8,
  },
  loadingText: {
    color: '#64748b',
  },
  container: {
    flex: 1,
    backgroundColor: '#fff7f7',
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#b91c1c',
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 16,
    color: '#64748b',
  },
  errorBox: {
    backgroundColor: '#fee2e2',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    color: '#991b1b',
  },
  retryButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#dc2626',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  retryText: {
    color: '#fff',
    fontWeight: '600',
  },
  search: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  needsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  needChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  needChipSelected: {
    backgroundColor: '#dc2626',
    borderColor: '#dc2626',
  },
  needChipText: {
    color: '#991b1b',
    fontSize: 12,
    fontWeight: '600',
  },
  needChipTextSelected: {
    color: '#fff',
  },
  list: {
    flex: 1,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  contactRowSelected: {
    borderColor: '#dc2626',
    backgroundColor: '#fef2f2',
  },
  contactAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#fee2e2',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  contactAvatarText: {
    color: '#b91c1c',
    fontWeight: '700',
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  contactPhone: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  emptyText: {
    textAlign: 'center',
    color: '#94a3b8',
    marginTop: 24,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  actionButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  callButton: {
    backgroundColor: '#0f172a',
  },
  shareButton: {
    backgroundColor: '#dc2626',
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
});
