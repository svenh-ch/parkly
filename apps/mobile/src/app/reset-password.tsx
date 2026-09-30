import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { z } from 'zod';
import { passwordSchema } from '@parking/shared';
import { useAuth } from '@/features/auth/AuthProvider';
import { useZodForm } from '@/hooks/use-zod-form';
import { userMessage } from '@/lib/errors';
import { Banner, Button, EmptyState, Screen, ScreenHeader, spacing, TextField } from '@/ui';

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwörter stimmen nicht überein' });

export default function ResetPassword() {
  const { isRecovering, completePasswordReset } = useAuth();
  const { expired } = useLocalSearchParams<{ expired?: string }>();
  const form = useZodForm(schema, { password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isRecovering || expired) {
    return (
      <Screen edges={['bottom']} footer={<Button title="Weiter" onPress={() => router.replace('/')} />}>
        <EmptyState
          icon="link-outline"
          title="Link ungültig"
          message="Dieser Link ist abgelaufen oder wurde bereits verwendet. Fordere bitte einen neuen an."
        />
      </Screen>
    );
  }

  const onSubmit = async () => {
    const data = form.submit();
    if (!data) return;
    setLoading(true);
    setError(null);
    try {
      await completePasswordReset(data.password);
      router.replace('/');
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen keyboard edges={['bottom']} footer={<Button title="Passwort speichern" loading={loading} onPress={onSubmit} />}>
      <ScreenHeader title="Neues Passwort" subtitle="Wähle ein sicheres Passwort, das du sonst nirgends verwendest." />
      <View style={{ gap: spacing.lg }}>
        {error ? <Banner>{error}</Banner> : null}
        <TextField
          label="Neues Passwort"
          password
          value={form.values.password}
          onChangeText={(v) => form.setValue('password', v)}
          onBlur={() => form.blur('password')}
          error={form.error('password')}
          autoComplete="new-password"
          textContentType="newPassword"
        />
        <TextField
          label="Passwort bestätigen"
          password
          value={form.values.confirm}
          onChangeText={(v) => form.setValue('confirm', v)}
          error={form.error('confirm')}
          autoComplete="new-password"
          onSubmitEditing={onSubmit}
        />
      </View>
    </Screen>
  );
}
