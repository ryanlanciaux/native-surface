import { Hero } from './sections/Hero';
import { Exploded } from './sections/Exploded';
import { UnderTheHood } from './sections/UnderTheHood';
import { Playground } from './sections/Playground';
import { FinalCta } from './sections/FinalCta';
import { Footer } from './sections/Footer';
import { useStageScale } from './components/useStageScale';

export function App() {
  useStageScale();
  return (
    <>
      <main>
        <Hero />
        <UnderTheHood />
        <Exploded />
        <Playground />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
