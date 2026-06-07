import { useCallback, useEffect, useState } from 'react';
import * as Contacts from 'expo-contacts';

export type SOSContact = {
  id: string;
  name: string;
  phone: string | null;
  initials: string;
};

function contactName(contact: Contacts.Contact): string {
  if (contact.name) return contact.name;
  const parts = [contact.firstName, contact.lastName].filter(Boolean);
  return parts.length ? parts.join(' ') : 'Unknown';
}

function primaryPhone(contact: Contacts.Contact): string | null {
  const numbers = contact.phoneNumbers ?? [];
  const mobile = numbers.find((p) => /mobile|cell|iphone/i.test(p.label ?? ''));
  return (mobile ?? numbers[0])?.number ?? null;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function mapContact(contact: Contacts.ExistingContact): SOSContact {
  const name = contactName(contact);
  return {
    id: contact.id || `${name}-${primaryPhone(contact) ?? 'no-phone'}`,
    name,
    phone: primaryPhone(contact),
    initials: initials(name),
  };
}

export function useSOSContacts() {
  const [contacts, setContacts] = useState<SOSContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [permissionStatus, setPermissionStatus] = useState<Contacts.PermissionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      setPermissionStatus(status);
      if (status !== 'granted') {
        setContacts([]);
        setError('Contacts permission is required to pick an emergency contact.');
        return;
      }

      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name, Contacts.Fields.FirstName, Contacts.Fields.LastName],
        sort: Contacts.SortTypes.FirstName,
      });

      const withPhone = data
        .filter((c) => (c.phoneNumbers?.length ?? 0) > 0)
        .map(mapContact)
        .sort((a, b) => a.name.localeCompare(b.name));

      setContacts(withPhone);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load contacts');
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadContacts().catch(() => {});
  }, [loadContacts]);

  return {
    contacts,
    loading,
    permissionStatus,
    error,
    reload: loadContacts,
  };
}
