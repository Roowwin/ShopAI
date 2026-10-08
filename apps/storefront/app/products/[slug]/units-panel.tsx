"use client";

import { useState } from "react";
import { aud } from "@/lib/api";
import { cartAdd } from "@/lib/cart";

type Unit = { id: number; grade: string; sale_price_cents: number; serial_tail: string };

export default function UnitsPanel({ units }: { units: Unit[] }) {
  const [added, setAdded] = useState<number[]>([]);
  return (
    <table className="w-full text-sm mt-6">
      <thead><tr className="text-left text-slate-500"><th>Grade</th><th>Serial (last 4)</th><th>Price</th><th></th></tr></thead>
      <tbody>
        {units.map((u) => (
          <tr key={u.id} className="border-t">
            <td className="py-2">{u.grade}</td>
            <td className="font-mono">••{u.serial_tail}</td>
            <td className="font-semibold">{aud(u.sale_price_cents)}</td>
            <td>
              <button className="border rounded px-3 py-1 disabled:opacity-40"
                      disabled={added.includes(u.id)}
                      onClick={() => { cartAdd({ asset_id: u.id, title: "product", grade: u.grade, price_cents: u.sale_price_cents, serial_tail: u.serial_tail }); setAdded([...added, u.id]); }}>
                {added.includes(u.id) ? "In cart" : "Add to cart"}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
