import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 10,
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    checks: ["rate>0.99"],
  },
};

const N = "https://nginx";

export default function () {
  const home = http.get(N + "/", { headers: { Host: "shop.rfo.localhost" } });
  check(home, { "home 200": (r) => r.status === 200 });
  const cat = http.get(N + "/store/catalog", { headers: { Host: "api.rfo.localhost" } });
  check(cat, { "catalog 200": (r) => r.status === 200 });
  const prod = http.get(N + "/products/galaxy-s21", { headers: { Host: "shop.rfo.localhost" } });
  check(prod, { "product 200": (r) => r.status === 200 });
  const srch = http.get(N + "/search?q=galaxy", { headers: { Host: "shop.rfo.localhost" } });
  check(srch, { "search 200": (r) => r.status === 200 });
  sleep(1);
}