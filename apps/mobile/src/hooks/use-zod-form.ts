import { useCallback, useState } from 'react';
import type { z } from 'zod';

/**
 * Minimaler Formular-Hook auf Basis der geteilten Zod-Schemas (gleiche Regeln wie die API).
 * Fehler werden erst nach dem ersten Absenden oder nach Verlassen eines Feldes angezeigt.
 */
export function useZodForm<S extends z.ZodType<Record<string, unknown>>>(schema: S, initial: z.input<S>) {
  type Values = z.input<S>;
  type Key = keyof Values & string;

  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<Key, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);

  const validate = useCallback(
    (next: Values) => {
      const result = schema.safeParse(next);
      const map: Partial<Record<Key, string>> = {};
      if (!result.success) {
        for (const issue of result.error.issues) {
          const key = issue.path[0] as Key | undefined;
          if (key && !map[key]) map[key] = issue.message;
        }
      }
      setErrors(map);
      return result;
    },
    [schema],
  );

  const setValue = useCallback(
    <K extends Key>(key: K, value: Values[K]) => {
      const next = { ...(values as Record<string, unknown>), [key]: value } as Values;
      setValues(next);
      if (submitted || touched[key]) validate(next);
    },
    [values, submitted, touched, validate],
  );

  const blur = useCallback(
    (key: Key) => {
      setTouched((t) => ({ ...t, [key]: true }));
      validate(values);
    },
    [validate, values],
  );

  /** Gibt die geparsten Werte zurück oder null, wenn die Validierung fehlschlägt. */
  const submit = useCallback((): z.output<S> | null => {
    setSubmitted(true);
    const result = validate(values);
    return result.success ? result.data : null;
  }, [validate, values]);

  const visibleError = (key: Key) => (submitted || touched[key] ? errors[key] : undefined);

  return { values, setValue, blur, submit, error: visibleError };
}
