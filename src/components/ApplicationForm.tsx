/**
 * The "what the application says" form. Plain, large fields with hints written
 * for a non-technical agent. Only brand name + beverage type are structurally
 * needed; everything else is optional and the engine reviews what it's given.
 */
"use client";

import { ApplicationData, BEVERAGE_LABELS, BeverageType, SELECTABLE_BEVERAGE_TYPES } from "@/lib/types";

export default function ApplicationForm({
  value,
  onChange,
  idPrefix = "app",
}: {
  value: ApplicationData;
  onChange: (next: ApplicationData) => void;
  idPrefix?: string;
}) {
  const set = (patch: Partial<ApplicationData>) => onChange({ ...value, ...patch });

  // Count how many optional fields are filled, so the expander can hint at it.
  const optionalFilled = [
    value.classType,
    value.alcoholContent,
    value.netContents,
    value.producer,
    value.originCountry,
  ].filter((v) => v && v.trim()).length;

  return (
    <div>
      {/* Primary fields — the only two an agent must touch. The AI reads the rest
          off the label; the optional fields are only for cross-checking against
          the application, so they stay tucked away to keep the screen calm. */}
      <div className="row">
        <div className="field">
          <label htmlFor={`${idPrefix}-brand`}>
            Brand name <span className="hint">(required)</span>
          </label>
          <input
            id={`${idPrefix}-brand`}
            type="text"
            value={value.brandName ?? ""}
            onChange={(e) => set({ brandName: e.target.value })}
            placeholder="e.g. Old Tom Distillery"
            required
            aria-required="true"
          />
        </div>

        <div className="field">
          <label htmlFor={`${idPrefix}-type`}>Beverage type</label>
          <select
            id={`${idPrefix}-type`}
            value={value.beverageType}
            onChange={(e) => set({ beverageType: e.target.value as BeverageType })}
          >
            {SELECTABLE_BEVERAGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {BEVERAGE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <details className="more-details">
        <summary>
          Add more label details
          {optionalFilled > 0 ? ` (${optionalFilled} added)` : " (optional)"}
        </summary>
        <p className="more-details-note">
          Enter the values from the application and the tool will compare them to
          the label. Leave blank to just read what&rsquo;s on the label.
        </p>

        <div className="field">
          <label htmlFor={`${idPrefix}-class`}>Class / type</label>
          <input
            id={`${idPrefix}-class`}
            type="text"
            value={value.classType ?? ""}
            onChange={(e) => set({ classType: e.target.value })}
            placeholder="e.g. Kentucky Straight Bourbon Whiskey"
          />
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor={`${idPrefix}-abv`}>Alcohol content</label>
            <input
              id={`${idPrefix}-abv`}
              type="text"
              value={value.alcoholContent ?? ""}
              onChange={(e) => set({ alcoholContent: e.target.value })}
              placeholder="e.g. 45% (90 Proof)"
            />
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-net`}>Net contents</label>
            <input
              id={`${idPrefix}-net`}
              type="text"
              value={value.netContents ?? ""}
              onChange={(e) => set({ netContents: e.target.value })}
              placeholder="e.g. 750 mL"
            />
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor={`${idPrefix}-producer`}>Bottler / producer</label>
            <input
              id={`${idPrefix}-producer`}
              type="text"
              value={value.producer ?? ""}
              onChange={(e) => set({ producer: e.target.value })}
              placeholder="e.g. Old Tom Distillery, Bardstown, KY"
            />
          </div>

          <div className="field">
            <label htmlFor={`${idPrefix}-origin`}>
              Country of origin <span className="hint">(imports only)</span>
            </label>
            <input
              id={`${idPrefix}-origin`}
              type="text"
              value={value.originCountry ?? ""}
              onChange={(e) => set({ originCountry: e.target.value })}
              placeholder="e.g. Scotland"
            />
          </div>
        </div>
      </details>
    </div>
  );
}

/** A fresh, empty application. */
export function emptyApplication(): ApplicationData {
  return {
    brandName: "",
    beverageType: "auto",
    classType: "",
    alcoholContent: "",
    netContents: "",
    producer: "",
    originCountry: "",
  };
}
