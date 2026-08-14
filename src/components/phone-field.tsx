/**
 * Shared international phone input — the ONE phone input for all of HEOS.
 *
 * Renders a country selector (default 🇮🇳 +91) beside a national-number input.
 * `onChange` always emits the canonical E.164 value (or the raw digits while
 * the number is still incomplete) so callers persist a storage-ready value.
 *
 * Validation is delegated to `@/lib/phone` (libphonenumber-js) — never
 * re-implement phone rules in a screen.
 */
import { useEffect, useMemo, useState } from "react";
import {
  PHONE_COUNTRIES, callingCodeFor, splitPhone, validatePhoneNumber,
  DEFAULT_COUNTRY, type CountryCode,
} from "@/lib/phone";

export interface PhoneFieldProps {
  value: string | null | undefined;
  onChange: (e164: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  /** Show an inline "not a valid number" hint when non-empty and invalid. */
  showError?: boolean;
  errorText?: string;
}

const baseInput =
  "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gold/60";

export function PhoneField({
  value, onChange, placeholder = "Mobile number", className, disabled,
  autoFocus, id, showError, errorText = "Enter a valid phone number for the selected country.",
}: PhoneFieldProps) {
  const initial = useMemo(() => splitPhone(value, DEFAULT_COUNTRY), []);
  const [country, setCountry] = useState<CountryCode>(initial.country);
  const [national, setNational] = useState(initial.national);

  // Adopt externally-set values (edit dialogs loading a record, resets, etc.).
  useEffect(() => {
    const next = splitPhone(value, country);
    const current = `+${callingCodeFor(country)}${national.replace(/\D/g, "")}`;
    if ((value ?? "") !== current) {
      setCountry(next.country);
      setNational(next.national);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (c: CountryCode, nat: string) => {
    const digits = nat.replace(/\D/g, "");
    onChange(digits ? `+${callingCodeFor(c)}${digits}` : "");
  };

  const invalid = !!showError && !!national.trim() && !validatePhoneNumber(`+${callingCodeFor(country)}${national}`, country);

  return (
    <div className={className}>
      <div className="flex gap-2">
        <select
          aria-label="Country code"
          value={country}
          disabled={disabled}
          onChange={(e) => {
            const c = e.target.value as CountryCode;
            setCountry(c);
            emit(c, national);
          }}
          className="shrink-0 w-[112px] bg-input/60 border border-border rounded-md px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gold/60"
        >
          {PHONE_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} +{callingCodeFor(c.code)}
            </option>
          ))}
        </select>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          autoFocus={autoFocus}
          disabled={disabled}
          value={national}
          placeholder={placeholder}
          onChange={(e) => {
            const nat = e.target.value.replace(/[^\d\s\-()]/g, "");
            setNational(nat);
            emit(country, nat);
          }}
          className={baseInput}
        />
      </div>
      {invalid && <div className="text-[11px] text-destructive mt-1">{errorText}</div>}
    </div>
  );
}

export default PhoneField;
