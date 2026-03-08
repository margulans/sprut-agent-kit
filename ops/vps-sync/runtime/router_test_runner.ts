import fixtures from "./router_fixtures.json";
import { decideRouterContract, type RouterAction, type RouterContractInput } from "./router_contract";

interface RouterFixture {
  name: string;
  input: RouterContractInput;
  expectedAction: RouterAction;
}

const rows = fixtures as RouterFixture[];
const failures: string[] = [];

for (const row of rows) {
  const result = decideRouterContract(row.input);
  if (result.action !== row.expectedAction) {
    failures.push(`${row.name}: expected=${row.expectedAction}, got=${result.action}, reason=${result.reason}`);
  }
}

if (failures.length > 0) {
  console.error("Router fixture failures:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log(`Router fixtures passed: ${rows.length}`);
