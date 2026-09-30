import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { z } from 'zod';
import { phoneSchema, updateMeSchema, type Me } from '@parking/shared';
import { useMe, useUpdateMe } from '@/features/profile/queries';
import { useZodForm } from '@/hooks/use-zod-form';
import { userMessage } from '@/lib/errors';
import { Banner, Button, ErrorState, Screen, Skeleton, spacing, TextField } from '@/ui';

/** Formularschema: leeres Telefonfeld = Nummer entfernen. */
const formSchema = z.object({
  firstName: updateMeSchema.shape.firstName.unwrap(),
  lastName: updateMeSchema.shape.lastName.unwrap(),
  phone: z.union([z.literal('').transform(() => null), phoneSchema]),
});

export default function EditProfile() {
  const me = useMe();
  if (me.isPending) {
    return (
      <Screen edges={['bottom']} contentStyle={{ gap: spacing.lg, paddingTop: spacing.lg }}>
        <Skeleton height={52} />
        <Skeleton height={52} />
        <Skeleton height={52} />
      </Screen>
    );
  }
  if (me.isError) return <ErrorState message={userMessage(me.error)} onRetry={() => void me.refetch()} />;
  return <EditForm me={me.data} />;
}

function EditForm({ me }: { me: Me }) {
  const update = useUpdateMe();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(formSchema, {
    firstName: me.firstName ?? '',
    lastName: me.lastName ?? '',
    phone: me.phone ?? '',
  });

  const onSave = () => {
    const data = form.submit();
    if (!data) return;
    setError(null);
    update.mutate(data, {
      onSuccess: () => router.back(),
      onError: (e) => setError(userMessage(e)),
    });
  };

  return (
    <Screen keyboard edges={['bottom']} footer={<Button title="Speichern" loading={update.isPending} onPress={onSave} />}>
      <View style={{ gap: spacing.lg, paddingTop: spacing.lg }}>
        {error ? <Banner>{error}</Banner> : null}
        <TextField
          label="Vorname"
          value={form.values.firstName}
          onChangeText={(v) => form.setValue('firstName', v)}
          onBlur={() => form.blur('firstName')}
          error={form.error('firstName')}
          autoComplete="given-name"
        />
        <TextField
          label="Nachname"
          value={form.values.lastName}
          onChangeText={(v) => form.setValue('lastName', v)}
          onBlur={() => form.blur('lastName')}
          error={form.error('lastName')}
          autoComplete="family-name"
        />
        <TextField
          label="Telefon (optional)"
          value={form.values.phone ?? ''}
          onChangeText={(v) => form.setValue('phone', v)}
          onBlur={() => form.blur('phone')}
          error={form.error('phone')}
          hint="Nur für Rückfragen zu deinen Buchungen"
          keyboardType="phone-pad"
          autoComplete="tel"
          placeholder="+41 79 123 45 67"
        />
        <TextField label="E-Mail" value={me.email} editable={false} hint="Die E-Mail-Adresse kann derzeit nicht geändert werden." />
      </View>
    </Screen>
  );
}
