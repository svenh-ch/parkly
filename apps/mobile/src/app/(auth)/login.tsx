import { useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { signInSchema } from '@parking/shared';
import { useAuth } from '@/features/auth/AuthProvider';
import { useZodForm } from '@/hooks/use-zod-form';
import { userMessage } from '@/lib/errors';
import { Banner, Button, colors, Screen, ScreenHeader, spacing, Text, TextField } from '@/ui';

export default function Login() {
  const { signIn } = useAuth();
  const form = useZodForm(signInSchema, { email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  const onSubmit = async () => {
    const data = form.submit();
    if (!data) return;
    setError(null);
    setLoading(true);
    try {
      await signIn(data);
      // Navigation übernimmt der Auth-Guard im Root-Layout
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen keyboard edges={['bottom']} footer={<Button title="Anmelden" loading={loading} onPress={onSubmit} />}>
      <ScreenHeader title="Willkommen zurück" subtitle="Melde dich mit deiner E-Mail-Adresse an." />
      <View style={{ gap: spacing.lg }}>
        {error ? <Banner>{error}</Banner> : null}
        <TextField
          label="E-Mail"
          value={form.values.email}
          onChangeText={(v) => form.setValue('email', v)}
          onBlur={() => form.blur('email')}
          error={form.error('email')}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <TextField
          ref={passwordRef}
          label="Passwort"
          password
          value={form.values.password}
          onChangeText={(v) => form.setValue('password', v)}
          error={form.error('password')}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />
        <Link href="/forgot-password" asChild>
          <Pressable hitSlop={8} accessibilityRole="link">
            <Text variant="captionStrong" style={{ color: colors.accent }}>
              Passwort vergessen?
            </Text>
          </Pressable>
        </Link>
      </View>
    </Screen>
  );
}
