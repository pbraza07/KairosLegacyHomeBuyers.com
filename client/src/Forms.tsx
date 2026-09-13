import { useEffect, useRef, useState, useId } from "react";
import { Link } from "react-router-dom";
import {
  propertySchema,
  conditionSchema,
  contactStepSchema,
  messageSchema,
  offerSchema,
} from "../../shared/validation";
import type { SiteContent } from "../../shared/content";
import { api } from "./api";
function requestId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const initial = {
  street: "",
  city: "",
  state: "FL",
  zip: "",
  propertyType: "",
  bedrooms: "",
  bathrooms: "",
  sqft: "",
  yearBuilt: "",
  condition: "",
  occupancy: "",
  timeline: "",
  askingPrice: "",
  reason: "",
  details: "",
  fullName: "",
  email: "",
  phone: "",
  preferred: "Email",
  acknowledgment: false,
  message: "",
};
export type FormData = typeof initial;
export const initialOffer = () => ({ ...initial });
const states =
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
    " ",
  );
export function Field({
  name,
  label,
  data,
  set,
  errors,
  options,
  type = "text",
  required = false,
  wide = false,
  prefix = "",
}: {
  prefix?: string;
  name: keyof FormData;
  label: string;
  data: FormData;
  set: (name: keyof FormData, value: any) => void;
  errors: Record<string, string>;
  options?: string[];
  type?: string;
  required?: boolean;
  wide?: boolean;
}) {
  const id = `${prefix}field-${name}`;
  return (
    <div className={`field ${wide ? "wide" : ""}`}>
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {options ? (
        <select
          id={id}
          name={name}
          value={String(data[name])}
          onChange={(e) => set(name, e.target.value)}
          required={required}
          aria-invalid={!!errors[name]}
          aria-describedby={errors[name] ? `${id}-error` : undefined}
        >
          {options.map((v) => (
            <option key={v} value={v}>
              {v || "Select an option"}
            </option>
          ))}
        </select>
      ) : type === "textarea" ? (
        <textarea
          id={id}
          name={name}
          rows={4}
          maxLength={4000}
          value={String(data[name])}
          onChange={(e) => set(name, e.target.value)}
          aria-invalid={!!errors[name]}
          aria-describedby={errors[name] ? `${id}-error` : undefined}
        />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          value={String(data[name])}
          onChange={(e) => set(name, e.target.value)}
          required={required}
          maxLength={name === "zip" ? 10 : name === "email" ? 254 : 200}
          min={type === "number" ? 0 : undefined}
          step={
            name === "bathrooms" ? "0.5" : type === "number" ? "1" : undefined
          }
          autoComplete={
            (
              {
                street: "street-address",
                city: "address-level2",
                state: "address-level1",
                zip: "postal-code",
                fullName: "name",
                email: "email",
                phone: "tel",
              } as Record<string, string>
            )[name] || "off"
          }
          aria-invalid={!!errors[name]}
          aria-describedby={errors[name] ? `${id}-error` : undefined}
        />
      )}{" "}
      {errors[name] && (
        <span className="field-error" id={`${id}-error`}>
          {errors[name]}
        </span>
      )}
    </div>
  );
}
function Captcha({
  siteKey,
  onToken,
  reset,
}: {
  siteKey: string;
  onToken: (token: string) => void;
  reset: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!siteKey) return;
    let widget: string | undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const render = () => {
      if (stopped) return;
      const ts = (window as any).turnstile;
      if (!ts) {
        timer = setTimeout(render, 150);
        return;
      }
      widget = ts.render(ref.current, {
        sitekey: siteKey,
        callback: onToken,
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
      });
    };
    if (!document.querySelector("script[data-turnstile]")) {
      const s = document.createElement("script");
      s.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.dataset.turnstile = "true";
      s.async = true;
      document.head.appendChild(s);
    }
    render();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (widget) (window as any).turnstile?.remove(widget);
    };
  }, [siteKey, reset]);
  return siteKey ? <div ref={ref} className="captcha" /> : null;
}
function errorsFrom(result: any) {
  return Object.fromEntries(
    result.error.issues.map((issue: any) => [issue.path[0], issue.message]),
  );
}
export function InquiryForm({
  content,
  siteKey,
  contact = false,
  data,
  onChange,
  onComplete,
}: {
  content: SiteContent;
  siteKey: string;
  contact?: boolean;
  data?: FormData;
  onChange?: (d: FormData) => void;
  onComplete?: () => void;
}) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [local, setLocal] = useState(initialOffer);
  const values = data || local;
  const change = onChange || setLocal;
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [token, setToken] = useState("");
  const [reset, setReset] = useState(0);
  const [trap, setTrap] = useState("");
  const request = useRef({ id: requestId(), serialized: "" });
  const heading = useRef<HTMLHeadingElement>(null);
  const set = (name: keyof FormData, value: any) => {
    change({ ...values, [name]: value });
    setErrors((e) => ({ ...e, [name]: "" }));
  };
  useEffect(() => {
    if (step > 0) heading.current?.focus();
  }, [step]);
  const focusError = (e: Record<string, string>) =>
    setTimeout(
      () =>
        document.getElementById(`${formId}field-${Object.keys(e)[0]}`)?.focus(),
      0,
    );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    const schema = contact
      ? messageSchema
      : step === 0
        ? propertySchema
        : step === 1
          ? conditionSchema
          : contactStepSchema;
    const result = schema.safeParse(
      contact
        ? {
            fullName: values.fullName,
            email: values.email,
            phone: values.phone,
            preferred: values.preferred,
            acknowledgment: values.acknowledgment,
            message: values.message,
          }
        : values,
    );
    if (!result.success) {
      const errs = errorsFrom(result);
      setErrors(errs);
      focusError(errs);
      return;
    }
    setErrors({});
    if (!contact && step < 2) {
      setStep(step + 1);
      return;
    }
    const { message, ...offer } = values;
    const parsed = (contact ? messageSchema : offerSchema).safeParse(
      contact ? result.data : offer,
    );
    if (!parsed.success) {
      const errs = errorsFrom(parsed);
      setErrors(errs);
      setError("Please review the form entries.");
      return;
    }
    if (siteKey && !token) {
      setError("Please complete the spam-protection check.");
      return;
    }
    const serialized = JSON.stringify(parsed.data);
    if (request.current.serialized && request.current.serialized !== serialized)
      request.current.id = requestId();
    request.current.serialized = serialized;
    setBusy(true);
    try {
      const response = await api(`/api/${contact ? "contact" : "offer"}`, {
        method: "POST",
        body: JSON.stringify({
          id: request.current.id,
          trap,
          token,
          data: parsed.data,
        }),
      });
      if (!response.saved)
        throw new Error(
          "We couldn’t confirm the inquiry was saved. Please try again.",
        );
      setSuccess(true);
      onComplete?.();
      change(initialOffer());
      setTimeout(() => heading.current?.focus(), 0);
    } catch (err: any) {
      setError(err.message);
      if (err.fields)
        setErrors(
          Object.fromEntries(
            Object.entries(err.fields).map(([k, v]) => [k, (v as string[])[0]]),
          ),
        );
      setToken("");
      setReset((v) => v + 1);
    } finally {
      setBusy(false);
    }
  }
  if (success)
    return (
      <div className="form-success" role="status">
        <span className="success-icon" aria-hidden="true">
          ✓
        </span>
        <h2 tabIndex={-1} ref={heading}>
          You’ve taken the first step.
        </h2>
        <p>{contact ? content.contact.success : content.offer.success}</p>
        <button
          className="button outline"
          onClick={() => {
            setSuccess(false);
            setStep(0);
            request.current = { id: requestId(), serialized: "" };
          }}
        >
          Start another inquiry
        </button>
      </div>
    );
  const props = { data: values, set, errors, prefix: formId };
  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      className="inquiry-form"
      aria-busy={busy}
    >
      {!contact && (
        <ol className="progress" aria-label="Form progress">
          {["Property", "Condition & timing", "Contact"].map((label, i) => (
            <li
              key={label}
              className={i === step ? "current" : i < step ? "complete" : ""}
              aria-current={i === step ? "step" : undefined}
            >
              <span>{i < step ? "✓" : i + 1}</span>
              <b>{label}</b>
            </li>
          ))}
        </ol>
      )}
      <h2 ref={heading} tabIndex={-1} className="form-step-title">
        {contact
          ? content.contact.formTitle
          : [
              "First, the basics.",
              "A little more about your home.",
              "How can we reach you?",
            ][step]}
      </h2>
      <p className="form-hint">Fields marked * are required.</p>
      <fieldset disabled={busy} className="fields">
        <legend className="sr-only">
          {contact ? "Your message" : `Step ${step + 1}`}
        </legend>
        {!contact && step === 0 && (
          <>
            <Field
              {...props}
              name="street"
              label="Street address"
              required
              wide
            />
            <Field {...props} name="city" label="City" required />
            <Field
              {...props}
              name="state"
              label="State"
              options={states}
              required
            />
            <Field {...props} name="zip" label="ZIP code" required />
            <Field
              {...props}
              name="propertyType"
              label="Property type"
              options={[
                "",
                "Single-family",
                "Townhouse",
                "Condo",
                "Manufactured",
                "Multi-family",
                "Other",
              ]}
            />
            <Field {...props} name="bedrooms" label="Bedrooms" type="number" />
            <Field
              {...props}
              name="bathrooms"
              label="Bathrooms"
              type="number"
            />
            <Field
              {...props}
              name="sqft"
              label="Approximate square footage"
              type="number"
            />
            <Field
              {...props}
              name="yearBuilt"
              label="Year built (optional)"
              type="number"
            />
          </>
        )}
        {!contact && step === 1 && (
          <>
            <Field
              {...props}
              name="condition"
              label="Condition"
              options={[
                "",
                "Updated",
                "Minor repairs",
                "Major repairs",
                "Unsure",
              ]}
            />
            <Field
              {...props}
              name="occupancy"
              label="Occupancy"
              options={[
                "",
                "Owner occupied",
                "Tenant occupied",
                "Vacant",
                "Other",
              ]}
            />
            <Field
              {...props}
              name="timeline"
              label="Desired selling timeline"
              options={[
                "",
                "As soon as practical",
                "1–3 months",
                "3–6 months",
                "6+ months",
                "Just exploring",
              ]}
              wide
            />
            <Field
              {...props}
              name="askingPrice"
              label="Asking price or what you think your house is worth ($, optional)"
              type="number"
              wide
            />
            <Field
              {...props}
              name="reason"
              label="Reason for selling (optional)"
              wide
            />
            <Field
              {...props}
              name="details"
              label="Additional property details (optional)"
              type="textarea"
              wide
            />
          </>
        )}
        {(contact || step === 2) && (
          <>
            <Field {...props} name="fullName" label="Full name" required wide />
            <Field
              {...props}
              name="email"
              label="Email"
              type="email"
              required
            />
            <Field
              {...props}
              name="phone"
              label={`Phone${values.preferred === "Email" ? " (optional)" : ""}`}
              type="tel"
              required={values.preferred !== "Email"}
            />
            <Field
              {...props}
              name="preferred"
              label="Preferred contact method"
              options={["Email", "Phone", "Text"]}
              wide
            />
            {contact && (
              <Field
                {...props}
                name="message"
                label="Message"
                type="textarea"
                required
                wide
              />
            )}
            <div className="wide consent">
              <label>
                <input
                  id={`${formId}field-acknowledgment`}
                  type="checkbox"
                  checked={values.acknowledgment}
                  onChange={(e) => set("acknowledgment", e.target.checked)}
                  aria-invalid={!!errors.acknowledgment}
                />
                <span>
                  {content.offer.acknowledgment}{" "}
                  <Link to="/privacy" target="_blank" rel="noopener">
                    Privacy Policy (opens in a new tab)
                  </Link>
                </span>
              </label>
              {errors.acknowledgment && (
                <p className="field-error">{errors.acknowledgment}</p>
              )}
            </div>
          </>
        )}
      </fieldset>
      <div className="honeypot" aria-hidden="true">
        <label>
          Leave this empty
          <input
            tabIndex={-1}
            autoComplete="off"
            value={trap}
            onChange={(e) => setTrap(e.target.value)}
          />
        </label>
      </div>
      {(contact || step === 2) && (
        <>
          <Captcha siteKey={siteKey} onToken={setToken} reset={reset} />
          {!contact && <p className="disclaimer">{content.offer.disclaimer}</p>}
        </>
      )}
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      <div className="form-actions">
        {!contact && step > 0 && (
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() => {
              setStep(step - 1);
              setErrors({});
              setError("");
            }}
          >
            ← Back
          </button>
        )}
        <button className="button" type="submit" disabled={busy}>
          {busy
            ? "Saving your inquiry…"
            : contact
              ? "Send message"
              : step === 2
                ? "Request my offer review."
                : "Continue"}
          {!contact && step < 2 && <span aria-hidden="true"> →</span>}
        </button>
      </div>
    </form>
  );
}
