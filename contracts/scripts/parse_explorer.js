import fs from "fs";

function main() {
  const filePath = "C:\\Users\\IFEANYICHUKWU\\.gemini\\antigravity-ide\\brain\\99cfd394-2e3b-4e23-b760-d36c65210b3c\\.system_generated\\steps\\587\\content.md";
  const html = fs.readFileSync(filePath, "utf-8");

  console.log("Analyzing 0xD0B04 explorer page...");
  
  const terms = [
    "Contract Name",
    "Contract Creator",
    "Bytecode",
    "Token Tracker",
    "Balance",
    "Transactions",
    "EOA"
  ];

  for (const term of terms) {
    const idx = html.toLowerCase().indexOf(term.toLowerCase());
    if (idx !== -1) {
      console.log(`Found "${term}" at index ${idx}`);
      console.log(html.substring(idx - 50, idx + 150));
    }
  }
}

main();
