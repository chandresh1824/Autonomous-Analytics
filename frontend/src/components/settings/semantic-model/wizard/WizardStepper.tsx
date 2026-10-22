import { Icon } from '@/components/common/Icon';
import { WIZARD_GROUPS, WIZARD_STEPS, type WizardStep } from './wizardSteps';

interface WizardStepperProps {
  current: WizardStep;
  /** Jump back to an earlier step. Later steps can't be jumped to - each
   * step's "Next" may run setup the following steps rely on. */
  onSelect: (step: WizardStep) => void;
  disabled?: boolean;
}

/** Numbered progress stepper, grouped and coloured like the Semantic Model
 * page's sections: data model steps, business logic steps, then publish. */
export function WizardStepper({ current, onSelect, disabled }: WizardStepperProps) {
  const currentIndex = WIZARD_STEPS.findIndex((s) => s.key === current);
  const progress = ((currentIndex + 1) / WIZARD_STEPS.length) * 100;

  return (
    <div className="wz-stepper-wrap">
      <ol className="wz-stepper" aria-label="Setup steps">
        {WIZARD_GROUPS.map((group) => (
          <li key={group.label} className="wz-stepper-group" data-tone={group.tone}>
            <span className="wz-stepper-group-label">{group.label}</span>
            <ol className="wz-stepper-steps">
              {group.steps.map((step) => {
                const index = WIZARD_STEPS.findIndex((s) => s.key === step.key);
                const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
                const clickable = state === 'done' && !disabled;
                return (
                  <li key={step.key} className={`wz-step wz-step-${state}`} data-tone={step.tone}>
                    <button
                      type="button"
                      className="wz-step-button"
                      onClick={clickable ? () => onSelect(step.key) : undefined}
                      disabled={!clickable && state !== 'current'}
                      aria-current={state === 'current' ? 'step' : undefined}
                      title={clickable ? `Back to ${step.label}` : undefined}
                    >
                      <span className="wz-step-bubble">
                        {state === 'done' ? <Icon name="check" size={13} strokeWidth={2.6} /> : index + 1}
                      </span>
                      <span className="wz-step-label">
                        {step.label}
                        {step.optional && <span className="wz-step-optional">Optional</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
      <div
        className="wz-progress"
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={1}
        aria-valuemax={WIZARD_STEPS.length}
        aria-valuenow={currentIndex + 1}
      >
        <span className="wz-progress-bar" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
