import { Icon, IconName } from './Icon';

interface FeatureCardProps {
  icon: IconName;
  title: string;
  description: string;
}

/** Value-proposition tile used on the Home screen. */
export function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <article className="feature-card">
      <span className="feature-card-icon" aria-hidden="true">
        <Icon name={icon} size={24} />
      </span>
      <h3 className="feature-card-title">{title}</h3>
      <p className="feature-card-description">{description}</p>
    </article>
  );
}
