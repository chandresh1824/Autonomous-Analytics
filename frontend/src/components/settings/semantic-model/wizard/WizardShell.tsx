import type { ReactNode } from 'react';
import { Icon } from '@/components/common/Icon';
import { WizardStepper } from './WizardStepper';
import { WIZARD_STEPS, type WizardStep } from './wizardSteps';

interface WizardShellProps {
  step: WizardStep;
  onSelectStep: (step: WizardStep) => void;
  busy?: boolean;
  /** Small summary shown at the right of the step header (e.g. counts). */
  headerAside?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}

/** The wizard's single card: stepper, the current step's header, its body,
 * and the action footer. */
export function WizardShell({ step, onSelectStep, busy, headerAside, children, footer }: WizardShellProps) {
  const index = WIZARD_STEPS.findIndex((s) => s.key === step);
  const def = WIZARD_STEPS[index];

  return (
    <div className="wz-card" data-tone={def.tone}>
      <WizardStepper current={step} onSelect={onSelectStep} disabled={busy} />

      <header className="wz-step-header">
        <span className="wz-step-header-icon">
          <Icon name={def.icon} size={20} />
        </span>
        <div className="wz-step-header-text">
          <span className="wz-step-eyebrow">
            Step {index + 1} of {WIZARD_STEPS.length}
            {def.optional && ' · Optional'}
          </span>
          <h3>{def.title}</h3>
          <p>{def.description}</p>
        </div>
        {headerAside && <div className="wz-step-header-aside">{headerAside}</div>}
      </header>

      <div className="wz-body">{children}</div>

      <footer className="wz-footer">{footer}</footer>
    </div>
  );
}
