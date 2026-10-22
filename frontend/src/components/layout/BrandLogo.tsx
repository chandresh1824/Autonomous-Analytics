import { Link } from 'react-router-dom';
import { branding } from '@/config/branding';

interface BrandLogoProps {
  /** `wordmark` is the full lock-up, `mark` the square symbol only. */
  variant?: 'wordmark' | 'mark';
  /** Rendered height in pixels; width follows the image's aspect ratio. */
  height?: number;
  /** Wrap the logo in a link back to Home. */
  to?: string | null;
  className?: string;
}

export function BrandLogo({ variant = 'wordmark', height = 34, to = '/', className }: BrandLogoProps) {
  const image = (
    <img
      className={['brand-logo', `brand-logo-${variant}`, className].filter(Boolean).join(' ')}
      src={variant === 'mark' ? branding.logo.mark : branding.logo.wordmark}
      alt={branding.logo.alt}
      style={{ height }}
    />
  );

  if (!to) return image;
  return (
    <Link to={to} className="brand-logo-link" aria-label={`${branding.logo.alt} — ${branding.productName}`}>
      {image}
    </Link>
  );
}
