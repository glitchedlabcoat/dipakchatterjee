// components/admin/PasswordInput.tsx
//
// A labeled password field with a show/hide (eye icon) toggle, shared
// by ChangePasswordModal and AdminResetPasswordModal so both password
// flows get the same reveal behavior for free.

"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export default function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  placeholder,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  minLength?: number;
  placeholder?: string;
  /** Defaults to true, matching every existing caller (an actual password change/reset). Pass false for an optional secret-like field (e.g. a third-party API credential). */
  required?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-navy-900 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          minLength={minLength}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="w-full rounded-md border border-line bg-white px-3 py-2.5 pr-10 text-sm text-ink focus:border-saffron focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          tabIndex={-1}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-navy-900"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
