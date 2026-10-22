import { useNavigate } from 'react-router-dom';
import { AskBox } from '@/components/chat/AskBox';
import { Chip, ChipGroup } from '@/components/common/Chip';
import { FeatureCard } from '@/components/common/FeatureCard';
import { PageHeader } from '@/components/layout/PageHeader';
import { HOME_HIGHLIGHTS, SUGGESTED_QUESTIONS } from '@/config/branding';
import { useAuthUser } from '@/auth/useAuthUser';

/**
 * Ask screen (/ask): brand hero, the question composer and starter prompts.
 * Asking a question hands it to the chat route, which sends it on arrival.
 */
export function HomePage() {
  const navigate = useNavigate();
  const user = useAuthUser();

  const ask = (question: string) => {
    navigate('/conversation', { state: { question } });
  };

  return (
    <div className="home-page">
      <PageHeader />

      <section className="home-hero">
        <p className="home-greeting">Hello, {user.givenName}</p>
        <h1 className="home-headline">How can I help you today?</h1>

        <AskBox onSend={ask} autoFocus placeholder="Ask a business question" />

        <ChipGroup>
          {SUGGESTED_QUESTIONS.map((question) => (
            <Chip key={question} onClick={() => ask(question)} title={question}>
              {question}
            </Chip>
          ))}
        </ChipGroup>
      </section>

      <section className="home-highlights" aria-label="What you can do here">
        {HOME_HIGHLIGHTS.map((item) => (
          <FeatureCard key={item.title} {...item} />
        ))}
      </section>
    </div>
  );
}
