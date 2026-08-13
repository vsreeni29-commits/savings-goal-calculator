import { useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { CURRENCIES } from '../domain/format';
import { saveTextFile } from '../store/exportFile';
import { formatMonthKey, currentMonthKey } from '../domain/dates';
import {
  Card,
  ConfirmButton,
  Field,
  Segmented,
  Select,
  Toast,
  Toggle,
  useToast,
} from '../components/ui';

export default function SettingsScreen({ onBack }: { onBack: () => void }) {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const exportJson = useStore((s) => s.exportJson);
  const importJson = useStore((s) => s.importJson);
  const resetAll = useStore((s) => s.resetAll);

  const goals = useStore((s) => s.goals);
  const contributions = useStore((s) => s.contributions);
  const spendLogs = useStore((s) => s.spendLogs);

  const fileInput = useRef<HTMLInputElement>(null);
  const [toast, showToast] = useToast();
  const [importError, setImportError] = useState<string | null>(null);

  const download = async () => {
    // Goes through the shared helper because an <a download> does nothing
    // inside the phone app — there is no browser download manager there.
    const result = await saveTextFile(`goalvault-${currentMonthKey()}.json`, exportJson(), {
      mimeType: 'application/json',
      title: 'GoalVault backup',
    });
    if (result.ok) showToast(result.how === 'share' ? 'Choose where to save it' : 'Backup saved');
    else if (result.error !== 'cancelled') showToast(result.error);
  };

  const pickFile = async (file: File) => {
    setImportError(null);
    try {
      const text = await file.text();
      const result = importJson(text);
      if (result.ok) showToast('Plan restored');
      else setImportError(result.error);
    } catch {
      setImportError('That file could not be read.');
    }
  };

  return (
    <div className="screen">
      <div className="screen__head">
        <div>
          <h1 className="screen__title">Settings</h1>
          <p className="screen__sub">Everything stays on this device.</p>
        </div>
        <button type="button" className="icon-btn" aria-label="Back" onClick={onBack}>
          ✕
        </button>
      </div>

      <Card title="Display">
        <Field label="Currency">
          <Select
            value={settings.currency}
            onChange={(code) => {
              const meta = CURRENCIES.find((c) => c.code === code);
              updateSettings({ currency: code, locale: meta?.locale ?? settings.locale });
            }}
            options={CURRENCIES.map((c) => ({
              value: c.code,
              label: `${c.symbol}  ${c.name}`,
            }))}
          />
        </Field>

        <div style={{ height: 14 }} />

        <Field label="Theme">
          <Segmented
            label="Theme"
            options={[
              { id: 'system' as const, label: 'System' },
              { id: 'light' as const, label: 'Light' },
              { id: 'dark' as const, label: 'Dark' },
            ]}
            value={settings.theme}
            onChange={(theme) => updateSettings({ theme })}
          />
        </Field>
      </Card>

      <Card title="How the plan behaves">
        <Field
          label="Share money between goals by"
          hint="Deadlines are funded first either way. This decides where the rest goes."
        >
          <Segmented
            label="Allocation"
            options={[
              { id: 'priority' as const, label: 'Top first' },
              { id: 'balanced' as const, label: 'Split' },
              { id: 'fastestFirst' as const, label: 'Quick wins' },
            ]}
            value={settings.allocationStrategy}
            onChange={(allocationStrategy) => updateSettings({ allocationStrategy })}
          />
        </Field>

        <div style={{ height: 16 }} />

        <Field
          label={`Save ${Math.round(settings.savingsFactor * 100)}% of what is spare`}
          hint="Lower it if the plan feels tighter than your real life."
        >
          <input
            className="slider"
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(settings.savingsFactor * 100)}
            aria-label="Savings factor"
            onChange={(e) => updateSettings({ savingsFactor: Number(e.target.value) / 100 })}
          />
        </Field>

        <div className="divider" />

        <Toggle
          checked={settings.startMonth !== undefined}
          onChange={(on) =>
            updateSettings({ startMonth: on ? currentMonthKey() : undefined })
          }
          label="Pin the plan to a fixed start month"
          hint={
            settings.startMonth
              ? `Currently starting from ${formatMonthKey(settings.startMonth)}.`
              : 'Off means the plan always starts from the current month.'
          }
        />
      </Card>

      <Card title="Your data">
        <p className="small dim" style={{ marginBottom: 14, lineHeight: 1.55 }}>
          {goals.length} goal{goals.length === 1 ? '' : 's'}, {contributions.length} deposit
          {contributions.length === 1 ? '' : 's'} and {spendLogs.length} spending entr
          {spendLogs.length === 1 ? 'y' : 'ies'} are stored on this device. Nothing is uploaded
          anywhere — take a backup before you switch phones.
        </p>

        <div className="row" style={{ gap: 10 }}>
          <button
            type="button"
            className="btn"
            style={{ flex: 1 }}
            onClick={() => void download()}
          >
            Back up
          </button>
          <button
            type="button"
            className="btn"
            style={{ flex: 1 }}
            onClick={() => fileInput.current?.click()}
          >
            Restore
          </button>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void pickFile(file);
            e.target.value = '';
          }}
        />

        {importError && (
          <div className="notice notice--critical" style={{ marginTop: 12 }}>
            <span className="notice__glyph" aria-hidden="true">
              ⛔
            </span>
            <div>
              <div className="notice__title">Could not restore</div>
              <div className="notice__detail">{importError}</div>
            </div>
          </div>
        )}

        <div className="divider" style={{ margin: '16px 0' }} />

        <ConfirmButton
          className="btn btn--danger btn--block"
          label="Erase everything"
          confirmLabel="Tap again to erase for good"
          onConfirm={() => {
            void resetAll();
            showToast('Everything erased');
            onBack();
          }}
        />
      </Card>

      <Card title="About">
        <p className="small dim" style={{ lineHeight: 1.6 }}>
          GoalVault works out when your savings goals actually land, given what you earn, what you
          spend, and what you still owe. The projection runs month by month — cards accrue interest
          and absorb spending, minimum payments come out, and whatever is left is shared across
          your goals in the order you set.
        </p>
        <p className="small faint" style={{ marginTop: 12 }}>
          Figures are estimates, not financial advice. Returns and rates are assumptions you
          control.
        </p>
      </Card>

      <Toast message={toast} />
    </div>
  );
}
