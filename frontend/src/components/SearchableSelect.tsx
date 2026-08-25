import { useState, useRef, useEffect } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * 可搜索的单选下拉。输入部分名称实时过滤，适合模型/渠道等列表较长的场景。
 */
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));
  const selected = options.find((o) => o.value === value);

  return (
    <div className="relative" ref={ref}>
      {label && <label className="label">{label}</label>}
      <input
        className="input"
        value={open ? query : selected?.label || ""}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-pink-200 rounded-xl shadow-lg">
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-400">无匹配</div>
          )}
          {filtered.map((o) => (
            <div
              key={o.value}
              className={`px-3 py-2 text-sm cursor-pointer hover:bg-pink-50 ${
                o.value === value ? "bg-pink-100" : ""
              }`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
                setQuery("");
              }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
