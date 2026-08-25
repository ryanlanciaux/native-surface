import * as React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputRef } from 'react-native';

export interface InputFormProps {
  variant?: 'form' | 'secure' | 'multiline' | 'controlled';
  placeholder?: string;
}

/** Exercises the real TextInput primitive: type, tab/submit, blur. */
export function InputForm({ variant = 'form', placeholder = 'Type here…' }: InputFormProps) {
  const [name, setName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [submitted, setSubmitted] = React.useState<string | null>(null);
  const passwordRef = React.useRef<TextInputRef | null>(null);

  if (variant === 'secure') {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>Password</Text>
        <TextInput
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          style={styles.field}
          testID="secure-input"
        />
        <Text style={styles.echo}>length: {password.length}</Text>
      </View>
    );
  }

  if (variant === 'multiline') {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>Notes</Text>
        <TextInput
          multiline
          numberOfLines={4}
          value={notes}
          onChangeText={setNotes}
          placeholder="A few lines of text…"
          style={[styles.field, styles.multiline]}
          testID="multiline-input"
        />
        <Text style={styles.echo} testID="echo">
          {notes.length === 0 ? '(empty)' : notes}
        </Text>
      </View>
    );
  }

  if (variant === 'controlled') {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>Controlled (uppercased as you type)</Text>
        <TextInput
          value={name}
          onChangeText={(t) => setName(t.toUpperCase())}
          placeholder={placeholder}
          style={styles.field}
          testID="controlled-input"
        />
        <Text style={styles.echo} testID="echo">
          value: {name || '(empty)'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={placeholder}
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        blurOnSubmit={false}
        style={styles.field}
        testID="name-input"
      />
      <Text style={styles.label}>Password</Text>
      <TextInput
        ref={passwordRef}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        placeholder="Required"
        returnKeyType="done"
        onSubmitEditing={() => setSubmitted(`${name} / ${'•'.repeat(password.length)}`)}
        style={styles.field}
        testID="password-input"
      />
      <Text style={styles.echo} testID="echo">
        {submitted ? `submitted: ${submitted}` : `typing: ${name || '(empty)'}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 320,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  label: { fontSize: 12, fontWeight: '600', color: '#6A7181', letterSpacing: 0.3 },
  field: {
    height: 38,
    borderWidth: 1,
    borderColor: '#D5D9E0',
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 15,
    color: '#15181E',
    backgroundColor: '#FAFBFC',
  },
  multiline: { height: 92, paddingTop: 8 },
  echo: { fontSize: 13, color: '#3A404C', marginTop: 4 },
});
