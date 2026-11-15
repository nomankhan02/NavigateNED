"use client";

import {
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Badge } from "./Surfaces";
import { CloseIcon, SearchIcon } from "./icons";
import styles from "./ui.module.css";

export interface SearchOption {
  id: string;
  name: string;
  fullName?: string;
  number?: string;
  kind: "building" | "room";
  buildingName?: string;
  landmarkId?: string;
}

export interface FieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  label?: string;
  unit?: string;
  hint?: string;
  error?: string;
  mono?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  options?: readonly SearchOption[];
  onSelectOption?: (option: SearchOption) => void;
}

function rankSearchOptions(
  options: readonly SearchOption[],
  rawQuery: string,
  limit = 18,
): SearchOption[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) {
    return options.slice(0, limit);
  }

  const scored: { opt: SearchOption; tier: number }[] = [];
  for (const opt of options) {
    const nameLower = opt.name.toLowerCase();
    const fullLower = (opt.fullName ?? opt.name).toLowerCase();
    const numLower = (opt.number ?? "").toLowerCase();
    const bldgLower = (opt.buildingName ?? "").toLowerCase();

    let tier = 99;
    if (nameLower === q || numLower === q) {
      tier = 0;
    } else if (nameLower.startsWith(q) || numLower.startsWith(q)) {
      tier = 1;
    } else if (fullLower.startsWith(q)) {
      tier = 2;
    } else if (
      nameLower.includes(q) ||
      fullLower.includes(q) ||
      bldgLower.includes(q)
    ) {
      tier = 3;
    }

    if (tier < 99) {
      scored.push({ opt, tier });
    }
  }

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.opt.kind !== b.opt.kind) {
      return a.opt.kind === "building" ? -1 : 1;
    }
    if (a.opt.name.length !== b.opt.name.length) {
      return a.opt.name.length - b.opt.name.length;
    }
    return a.opt.name.localeCompare(b.opt.name);
  });

  return scored.slice(0, limit).map((s) => s.opt);
}

export function Field({
  label,
  unit,
  hint,
  error,
  mono = false,
  leading,
  trailing,
  options,
  onSelectOption,
  id,
  className,
  value,
  onFocus,
  onChange,
  onKeyDown,
  ...rest
}: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listboxId = `${inputId}-listbox`;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);

  const [isOpen, setIsOpen] = useState(false);
  const [hasTypedSinceOpen, setHasTypedSinceOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [openUpward, setOpenUpward] = useState(false);
  const [maxDropdownHeight, setMaxDropdownHeight] = useState(232);

  const hasDropdown = Boolean(options && onSelectOption);
  const queryString = typeof value === "string" ? value : "";

  const filteredOptions = useMemo(() => {
    if (!options || !onSelectOption) return [];
    // When first focused without typing, if query matches a single committed name, show full list if <2 matches
    const ranked = rankSearchOptions(options, hasTypedSinceOpen ? queryString : "");
    if (hasTypedSinceOpen) return ranked;
    const byCurrent = rankSearchOptions(options, queryString);
    return byCurrent.length > 1 ? byCurrent : ranked;
  }, [options, onSelectOption, queryString, hasTypedSinceOpen]);

  const updatePlacement = useCallback(() => {
    if (!rootRef.current || typeof window === "undefined") return;
    const rect = rootRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 14;
    const spaceAbove = rect.top - 62;
    if (spaceBelow < 165 && spaceAbove > spaceBelow) {
      setOpenUpward(true);
      setMaxDropdownHeight(Math.min(232, Math.max(115, Math.floor(spaceAbove))));
    } else {
      setOpenUpward(false);
      setMaxDropdownHeight(Math.min(232, Math.max(125, Math.floor(spaceBelow))));
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    updatePlacement();
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    window.addEventListener("resize", updatePlacement);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown, { passive: true });
    return () => {
      window.removeEventListener("resize", updatePlacement);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isOpen, updatePlacement]);

  useEffect(() => {
    if (isOpen && optionRefs.current[highlightIndex]) {
      optionRefs.current[highlightIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightIndex, isOpen]);

  const handleKeyDownInternal = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (!hasDropdown) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        updatePlacement();
        setIsOpen(true);
        setHighlightIndex(0);
      } else if (filteredOptions.length > 0) {
        setHighlightIndex((prev) => (prev + 1) % filteredOptions.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) {
        updatePlacement();
        setIsOpen(true);
        setHighlightIndex(Math.max(0, filteredOptions.length - 1));
      } else if (filteredOptions.length > 0) {
        setHighlightIndex(
          (prev) => (prev - 1 + filteredOptions.length) % filteredOptions.length,
        );
      }
    } else if (e.key === "Enter" && isOpen) {
      const chosen = filteredOptions[highlightIndex];
      if (chosen && onSelectOption) {
        e.preventDefault();
        onSelectOption(chosen);
        setIsOpen(false);
        setHasTypedSinceOpen(false);
      }
    } else if (e.key === "Escape" && isOpen) {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className={[styles.fieldRoot, className ?? ""].filter(Boolean).join(" ")}
    >
      {label || unit ? (
        <div className={styles.fieldHeader}>
          {label ? (
            <label htmlFor={inputId} className={styles.fieldLabel}>
              {label}
            </label>
          ) : (
            <span />
          )}
          {unit ? <span className={styles.fieldUnit}>{unit}</span> : null}
        </div>
      ) : null}

      <div
        className={[styles.inputShell, error ? styles.inputShellError : ""]
          .filter(Boolean)
          .join(" ")}
      >
        {leading ? <span className={styles.inputLeading}>{leading}</span> : null}
        <input
          id={inputId}
          value={value}
          role={hasDropdown ? "combobox" : undefined}
          aria-expanded={hasDropdown ? isOpen : undefined}
          aria-controls={hasDropdown && isOpen ? listboxId : undefined}
          aria-autocomplete={hasDropdown ? "list" : undefined}
          aria-invalid={Boolean(error) || undefined}
          autoComplete="off"
          onFocus={(e) => {
            onFocus?.(e);
            if (hasDropdown) {
              updatePlacement();
              setHasTypedSinceOpen(false);
              setHighlightIndex(0);
              setIsOpen(true);
            }
          }}
          onChange={(e) => {
            onChange?.(e);
            if (hasDropdown) {
              updatePlacement();
              setHasTypedSinceOpen(true);
              setHighlightIndex(0);
              setIsOpen(true);
            }
          }}
          onKeyDown={handleKeyDownInternal}
          className={[styles.input, mono ? styles.inputMono : ""]
            .filter(Boolean)
            .join(" ")}
          {...rest}
        />
        {trailing ? (
          <span className={styles.inputTrailing}>{trailing}</span>
        ) : null}
      </div>

      {hasDropdown && isOpen ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={label ?? "Search results"}
          style={{ maxHeight: `${maxDropdownHeight}px` }}
          className={[
            styles.searchDropdown,
            openUpward ? styles.searchDropdownUp : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt, idx) => {
              const active = idx === highlightIndex;
              const kindLabel =
                opt.kind === "room" && opt.buildingName
                  ? `Room · ${opt.buildingName}`
                  : "Building";
              return (
                <li
                  key={opt.id}
                  ref={(el) => {
                    optionRefs.current[idx] = el;
                  }}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  onMouseDown={(e) => {
                    // Prevent input blur before selection fires
                    e.preventDefault();
                    onSelectOption?.(opt);
                    setIsOpen(false);
                    setHasTypedSinceOpen(false);
                  }}
                  className={[
                    styles.searchOption,
                    active ? styles.searchOptionActive : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div className={styles.searchOptionLeft}>
                    {opt.number ? (
                      <Badge variant="building">{opt.number}</Badge>
                    ) : (
                      <Badge variant="neutral" numeric>
                        {opt.kind === "room" ? "RM" : "--"}
                      </Badge>
                    )}
                    <span className={styles.searchOptionName}>{opt.name}</span>
                  </div>
                  <span className={styles.searchOptionKind}>{kindLabel}</span>
                </li>
              );
            })
          ) : (
            <li className={styles.searchEmpty}>No matching buildings or rooms</li>
          )}
        </ul>
      ) : null}

      {error ? (
        <span role="alert" className={styles.fieldError}>
          {error}
        </span>
      ) : hint ? (
        <span className={styles.fieldHint}>{hint}</span>
      ) : null}
    </div>
  );
}

export interface SearchFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "onChange" | "value" | "onSelect"
  > {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  label?: string;
  shortcut?: string;
  resultCount?: number;
  options?: readonly SearchOption[];
  onSelectOption?: (option: SearchOption) => void;
}

export function SearchField({
  value,
  onChange,
  onClear,
  label,
  shortcut = "/",
  resultCount,
  options,
  onSelectOption,
  placeholder = "Search buildings or rooms...",
  id,
  ...rest
}: SearchFieldProps) {
  return (
    <Field
      id={id}
      label={label}
      unit={resultCount !== undefined ? `${resultCount} matches` : undefined}
      value={value}
      placeholder={placeholder}
      options={options}
      onSelectOption={onSelectOption}
      onChange={(e) => onChange(e.target.value)}
      leading={<SearchIcon size={16} />}
      trailing={
        value ? (
          <button
            type="button"
            className={styles.chipRemove}
            aria-label="Clear search"
            onClick={() => {
              onChange("");
              onClear?.();
            }}
          >
            <CloseIcon size={14} />
          </button>
        ) : shortcut ? (
          <kbd className={styles.kbdBadge}>{shortcut}</kbd>
        ) : null
      }
      {...rest}
    />
  );
}
