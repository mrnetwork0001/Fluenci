// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMintableToken {
    function mint(address to, uint256 amount) external;
    function decimals() external view returns (uint8);
}

contract MockQieDex {
    event Swap(address indexed user, address indexed tokenAddress, uint256 qieAmount, uint256 tokenAmount);

    // Mock exchange rates (scaled by 1e18)
    // 1 QIE = 2 qUSDC (since QIE native coin is traded, let's say 1 QIE is worth 2 USDC for test purposes)
    // 1 QIE = 0.001 MockWETH (1 WETH = 1000 QIE)
    mapping(address => uint256) public ratePerQie;

    constructor(address qUsdcAddress, address wethAddress) {
        // Rates scaled to 1e18:
        // qUSDC rate: 2 tokens per QIE. Since qUSDC has 6 decimals, 
        // WETH rate: 0.001 WETH per QIE. WETH has 18 decimals.
        ratePerQie[qUsdcAddress] = 2; 
        ratePerQie[wethAddress] = 1000; // 1 QIE = 0.001 WETH, so 1 WETH = 1000 QIE
    }

    function swapQieForTokens(address tokenAddress) external payable returns (uint256 tokenAmount) {
        require(msg.value > 0, "Must send QIE to swap");
        uint256 rate = ratePerQie[tokenAddress];
        require(rate > 0, "Unsupported swap token");

        uint8 decimals = IMintableToken(tokenAddress).decimals();

        if (decimals == 6) {
            // For 6 decimals (qUSDC): 
            // msg.value is in 18 decimals. 1 QIE (1e18 wei) = 2 qUSDC (2 * 1e6 units).
            // tokenAmount = (msg.value * rate) / 1e12
            tokenAmount = (msg.value * rate) / 1e12;
        } else {
            // For 18 decimals (MockWETH):
            // 1 QIE = 0.001 WETH, so tokenAmount = msg.value / 1000
            tokenAmount = msg.value / rate;
        }

        require(tokenAmount > 0, "Swap output too small");
        IMintableToken(tokenAddress).mint(msg.sender, tokenAmount);

        emit Swap(msg.sender, tokenAddress, msg.value, tokenAmount);
    }

    // Accept native QIE deposits
    receive() external payable {}
}
