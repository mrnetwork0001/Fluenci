import fs from "fs";

function main() {
  const filePath = "C:\\Users\\IFEANYICHUKWU\\.gemini\\antigravity-ide\\brain\\99cfd394-2e3b-4e23-b760-d36c65210b3c\\.system_generated\\steps\\648\\content.md";
  const html = fs.readFileSync(filePath, "utf-8");

  console.log("Analyzing user's explorer page...");
  
  // Find all hex addresses (0x...) in the HTML page
  const regex = /0x[a-fA-F0-9]{40}/g;
  const matches = html.match(regex) || [];
  
  // Get unique addresses
  const uniqueAddresses = Array.from(new Set(matches)).map(addr => addr.toLowerCase());
  console.log(`Found ${uniqueAddresses.length} unique addresses:`);
  
  // Filter out the user's own address
  const userAddr = "0x07f3d74e8bc5fdbfc02a3187dbd6cd08e96c05a8";
  const otherAddrs = uniqueAddresses.filter(addr => addr !== userAddr);
  
  for (const addr of otherAddrs) {
    console.log(` - ${addr}`);
  }
}

main();
