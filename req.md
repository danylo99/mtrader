Update the system to ensure correct price feed.


1. we will execute order via hyperliquid only.
2. we will use universe asset list
    asset list will have
    - display name
    - price provider source
    - symbol in hyperliquid
    make universal json from current hyperliquid asset json
    UI will show asset as asset display name
3. price feed source is
   - bybit for crypto 
   - metal , fx, index , stock from twelvedata
      twelvedata api key is bc8ff4898f54406196e95e5f30b0656b, store to env
4. as like as current candle provider will be provider of price internally
   it will get historical buffer with rest api and fill new bars with ws.
   another service required price will get from candle provider.
5. add UI to show asset list and chat.
   chat will get price from candle provider.
   we can choose asset from searchable combo box as like as another dashbaord.
6. execution layer must use symbol in hyperliquid when operate hyperliquid.
