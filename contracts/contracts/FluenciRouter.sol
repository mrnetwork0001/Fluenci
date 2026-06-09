// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FluenciRouter
 * @notice Routes swaps through QIEDex with on-chain Fluenci attribution.
 *         Every swap via Fluenci emits a `FluenciSwap` event so judges
 *         (and any explorer) can verify the swap originated from Fluenci.
 *
 *         On-chain flow:  User → FluenciRouter → QIEDex Router
 *         Explorer shows:  "to: FluenciRouter"  with internal tx to QIEDex.
 */

interface IQieDexRouter {
    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts);

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(
        uint256 amountIn,
        address[] calldata path
    ) external view returns (uint256[] memory amounts);
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

contract FluenciRouter {
    /// @notice Emitted for every swap routed through Fluenci
    event FluenciSwap(
        address indexed user,
        string  direction,       // "QIE_TO_TOKEN" or "TOKEN_TO_QIE"
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    /// @notice The underlying QIEDex router
    IQieDexRouter public immutable qieDexRouter;

    constructor(address _qieDexRouter) {
        require(_qieDexRouter != address(0), "Invalid router");
        qieDexRouter = IQieDexRouter(_qieDexRouter);
    }

    /**
     * @notice Swap native QIE for tokens via QIEDex, with Fluenci attribution.
     * @param amountOutMin Minimum tokens to receive (slippage protection)
     * @param path         Swap path (e.g. [WQIE, qUSDC])
     * @param to           Recipient of the output tokens
     * @param deadline     Unix timestamp deadline
     */
    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts) {
        amounts = qieDexRouter.swapExactETHForTokens{value: msg.value}(
            amountOutMin,
            path,
            to,
            deadline
        );

        emit FluenciSwap(
            msg.sender,
            "QIE_TO_TOKEN",
            path[0],
            path[path.length - 1],
            msg.value,
            amounts[amounts.length - 1]
        );
    }

    /**
     * @notice Swap tokens for native QIE via QIEDex, with Fluenci attribution.
     * @dev    Caller must approve this contract to spend `amountIn` of path[0].
     * @param amountIn     Amount of input tokens to swap
     * @param amountOutMin Minimum QIE to receive (slippage protection)
     * @param path         Swap path (e.g. [qUSDC, WQIE])
     * @param to           Recipient of the output QIE
     * @param deadline     Unix timestamp deadline
     */
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        // Pull tokens from user into this contract
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);

        // Approve QIEDex to spend the tokens (one-time max approval pattern)
        if (IERC20(path[0]).allowance(address(this), address(qieDexRouter)) < amountIn) {
            IERC20(path[0]).approve(address(qieDexRouter), type(uint256).max);
        }

        amounts = qieDexRouter.swapExactTokensForETH(
            amountIn,
            amountOutMin,
            path,
            to,
            deadline
        );

        emit FluenciSwap(
            msg.sender,
            "TOKEN_TO_QIE",
            path[0],
            path[path.length - 1],
            amountIn,
            amounts[amounts.length - 1]
        );
    }

    /**
     * @notice Passthrough quote from QIEDex (no attribution needed for reads).
     */
    function getAmountsOut(
        uint256 amountIn,
        address[] calldata path
    ) external view returns (uint256[] memory amounts) {
        return qieDexRouter.getAmountsOut(amountIn, path);
    }

    /// @notice Accept native QIE (needed for receiving QIE from router during token→QIE swaps)
    receive() external payable {}
}
