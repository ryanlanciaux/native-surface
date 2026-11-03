import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { NativeSurface, TextInput, Text, View, Pressable, ScrollView, type TextInputRef } from 'native-surface';
import { createAutomationController } from 'native-surface/automation';
import { attachSurface } from '../../src/browser';

const events: { keys: string[]; changes: string[]; trusted: boolean[]; submits: number } =
  { keys: [], changes: [], trusted: [], submits: 0 };
(window as unknown as { events: typeof events }).events = events;
document.addEventListener('keydown', event => events.trusted.push(event.isTrusted), true);
function Screen() {
  const inputRef = React.useRef<TextInputRef>(null);
  const multiRef = React.useRef<TextInputRef>(null);
  const [value, setValue] = React.useState('');
  const [count, setCount] = React.useState(0);
  const [show, setShow] = React.useState(true);
  React.useEffect(() => {
    if (!location.search.includes('churn')) return;
    const timer = setInterval(() => setCount(n => n + 1), 5);
    return () => clearInterval(timer);
  }, []);
  return <View style={{ width: 320, height: 640, padding: 10, backgroundColor: '#fff' }}>
    <TextInput ref={inputRef} testID="input" accessibilityLabel="Name" placeholder="Your name" value={value}
      editable={!location.search.includes('disableOnFirst') || value.length === 0}
      onFocus={() => { if (location.search.includes('redirectFocus')) multiRef.current?.focus(); }}
      onChangeText={text => { events.changes.push(text); setValue(text.toUpperCase());
        if (location.search.includes('blurOnFirst')) inputRef.current?.blur(); }}
      onKeyPress={event => events.keys.push(event.nativeEvent.key)}
      onSubmitEditing={() => events.submits++} style={{ width: 280, height: 40 }} />
    <TextInput ref={multiRef} testID="multi" multiline style={{ width: 280, height: 60 }} />
    <TextInput testID="password" secureTextEntry defaultValue="secret-fixture" style={{ width: 280, height: 40 }} />
    <TextInput testID="disabled" editable={false} defaultValue="fixed" style={{ width: 280, height: 40 }} />
    <Pressable testID="button" accessibilityRole="button" onPress={() => {
      localStorage.setItem('clicked', 'yes'); setCount(n => n + 1);
    }} style={{ height: 40 }}>
      <Text>Increment</Text>
    </Pressable>
    <Text testID="count">Count {count}</Text>
    <Text testID="stored">{localStorage.getItem('clicked') ?? 'empty'}</Text>
    <Pressable testID="remove" accessibilityRole="button" onPress={() => setShow(false)} style={{ height: 40 }}>
      <Text>Remove</Text>
    </Pressable>
    {show && <Text testID="temporary">Temporary</Text>}
    <Text testID="keys">{events.keys.join(',')}</Text>
    <Text testID="changes">{events.changes.join(',')}</Text>
    <Text testID="trusted">{events.trusted.join(',')}</Text>
    <View testID="box-none" pointerEvents="box-none" style={{ width: 280, height: 40 }}>
      <Pressable onPress={() => setCount(42)} style={{ height: 40, width: 280 }}><Text>Child</Text></Pressable>
    </View>
    <ScrollView testID="scroll" style={{ height: 130, width: 280 }}>
      {Array.from({ length: 20 }, (_, i) => <Text key={i} style={{ height: 30 }}>Row {i}</Text>)}
    </ScrollView>
    <Pressable testID="covered" onPress={() => setCount(99)} style={{ position: 'absolute', left: 220, top: 540, width: 80, height: 60 }}>
      <Text>Covered</Text>
    </Pressable>
    <Pressable testID="cover" style={{ position: 'absolute', left: 220, top: 540, width: 80, height: 60, backgroundColor: 'rgba(0,0,0,0.3)' }}>
      <Text>Cover</Text>
    </Pressable>
    {location.search.includes('detachBridge') && <Pressable testID="detach" accessibilityRole="button"
      onPress={() => (window as unknown as { detachApp: () => void }).detachApp()} style={{ height: 40 }}>
      <Text>Detach</Text>
    </Pressable>}
    {location.search.includes('centerInput') && <TextInput testID="center-input"
      style={{ position: 'absolute', left: 0, top: 300, width: 300, height: 80 }} />}
  </View>;
}
function Host({ id, left, second = false }: { id: string; left: number; second?: boolean }) {
  return <div style={{ position: 'absolute', left, top: 20,
    transform: location.search.includes('scaled') ? 'scale(0.8)' : undefined, transformOrigin: 'top left' }}><NativeSurface width={320} height={640} dpr={2}
    onReady={root => {
      const controller = createAutomationController(root);
      const attach = () => attachSurface({ id, controller, canvas: root.canvas as HTMLCanvasElement });
      const detach = attach();
      if (id !== 'app') return;
      (window as unknown as { detachApp: () => void }).detachApp = () => setTimeout(() => { detach(); setTimeout(attach, 800); }, 50);
      if (location.search.includes('navigateDuringObserve') && !sessionStorage.getItem('navigated')) {
        const registry = (window as unknown as Record<string, Record<string, { observe: () => Promise<unknown> }>>)['__surfaceE2E']!;
        registry[id]!.observe = () => { sessionStorage.setItem('navigated', 'yes'); location.reload(); return new Promise(() => {}); };
      }
    }}>
    {second ? <View><TextInput testID="other" secureTextEntry autoFocus={location.search.includes('otherFocus')}
      defaultValue="other-secret" style={{ height: 40, width: 280 }} /></View> : <Screen />}
  </NativeSurface></div>;
}
createRoot(document.getElementById('root')!).render(<><Host id="app" left={20} /><Host id="other" left={380} second /></>);
