import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import {
  AutoImage,
  Button,
  Card,
  EpisodeCard,
  FavButton,
  Header,
  Heading,
  Icon,
  ListItem,
  Screen,
  Text,
  TextField,
  Toggle,
  iconNames,
} from '../../components';
import { episodes } from '../../data/episodes';
import { colors } from '../../theme';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text preset="meta" weight="medium" text={title.toUpperCase()} style={styles.sectionTitle} />
      {children}
    </View>
  );
}

/** A mini showroom of every component, live and interactive. */
export function ComponentsScreen() {
  const [fav, setFav] = React.useState(false);
  const [presses, setPresses] = React.useState(0);
  const [name, setName] = React.useState('');
  const sample = episodes[1]!;
  return (
    <Screen preset="scroll" contentContainerStyle={styles.content}>
      <Heading text="Components" />
      <Text preset="formHelper" text="Every building block of this app, rendered live on the canvas." />

      <Section title="Text">
        <Text preset="heading" text="Heading" />
        <Text preset="subheading" text="Subheading" />
        <Text preset="title" text="Title" />
        <Text text="Default body text" />
        <Text preset="meta" text="Meta · 11pt" />
      </Section>

      <Section title="Button">
        <Button text={presses ? `Pressed ${presses}x` : 'Default'} onPress={() => setPresses((n) => n + 1)} />
        <Button preset="filled" text="Filled" leftIcon="star" />
        <Button preset="reversed" text="Reversed" />
      </Section>

      <Section title="Toggle">
        <Toggle variant="switch" label="Switch" defaultValue />
        <Toggle variant="checkbox" label="Checkbox" />
        <Toggle variant="radio" label="Radio" defaultValue />
      </Section>

      <Section title="FavButton">
        <View style={styles.row}>
          <FavButton isFavorite={fav} onPress={() => setFav((v) => !v)} />
          <FavButton isFavorite />
        </View>
      </Section>

      <Section title="EpisodeCard">
        <EpisodeCard episode={sample} isFavorite={fav} onPressFavorite={() => setFav((v) => !v)} />
      </Section>

      <Section title="Card">
        <Card heading="Card heading" content="Cards hold a heading, content and a footer." footer="Footer" />
      </Section>

      <Section title="ListItem">
        <View>
          <ListItem text="With left icon" leftIcon="star" topSeparator onPress={() => {}} />
          <ListItem text="With a value" value="42" />
        </View>
      </Section>

      <Section title="TextField">
        <TextField label="Name" placeholder="Jamon" value={name} onChangeText={setName} helper="Shown on your profile" />
      </Section>

      <Section title="Header">
        <Header title="Header" leftIcon="caretRight" rightIcon="search" style={styles.header} />
      </Section>

      <Section title="AutoImage">
        <AutoImage uri={sample.cover} maxWidth={96} style={styles.image} />
      </Section>

      <Section title="Icon">
        <View style={styles.icons}>
          {iconNames.map((n) => (
            <Icon key={n} icon={n} size={22} />
          ))}
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 10, paddingHorizontal: 24, paddingBottom: 32, gap: 24 },
  section: { gap: 10 },
  sectionTitle: { letterSpacing: 0.8 },
  row: { flexDirection: 'row', gap: 10 },
  header: { borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  image: { borderRadius: 12 },
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
});
