import { useDispatch } from "react-redux";
import { setApi } from "reducers/blockchainSlice";
import { WalletName, API, Token } from "utils";
import { TransactionUnspentOutput } from "@emurgo/cardano-serialization-lib-asmjs";
import axios from "axios";
let Buffer = require("buffer").Buffer;

/**
 * policy ID => asset name in hex => amount 
 */
interface AssetAmount {
  [key: string]: {
    [key: string]: number
  }
}

/**
 * info coming from API
 */
interface AssetDetail {
  decimals: number;
  ticker: string;
  policy_id: string;
  name_hex: string;
}

export default function useWallet() {
  const dispatch = useDispatch();

  /**
   * enable connection to wallet
   * @param walletName 
   */
  const enableWallet = async (walletName: string) => {
    try {
      let API: API = undefined;
      switch (walletName) {
        case WalletName.NAMI:
          API = await (window as any).cardano.nami.enable();
          break;
        case WalletName.CCVAULT:
          API = await (window as any).cardano.ccvault.enable();
          break;
        default:
          throw new Error();
      }
      localStorage.setItem("wallet", walletName);
      dispatch(setApi(API));
    } catch (err) {
      window.alert("Something is wrong");
      console.log(err);
    }
  };

  /**
   * get all the tokens inside the wallet
   * @param API 
   * @returns 
   */
  const getTokenArrayInWallet = async (API: any): Promise<Token[]> => {
    let adaAmount = 0;
    let assetsSummary: AssetAmount = {};

    try {
      /**
       * Only fetch usable UTXOs
       * check another function to get the collateral
       */
      const rawUtxos: string[] = await API.getUtxos();

      for (const rawUtxo of rawUtxos) {
        const { amount, multiasset } = parseUtxo(rawUtxo);
        adaAmount += Number(amount);

        if (multiasset) {
          /**
           * Check all asset type other than ADA
           * in each utxo
           */
          const keys = multiasset.keys();
          const numberOfAssetType = keys.len();

          for (let i = 0; i < numberOfAssetType; i++) {
            const policyId = keys.get(i);

            const assets = multiasset.get(policyId);
            if (assets == null) continue;
            const assetNames = assets.keys();
            const K = assetNames.len();

            const policyIdString = convertBufferToHex(policyId.to_bytes());

            if (!assetsSummary[policyIdString]) {
              assetsSummary[policyIdString] = {};
            }

            for (let j = 0; j < K; j++) {
              const assetName = assetNames.get(j);
              const assetNameHex = Buffer.from(
                (assetName as any).name(),
                "utf8"
              ).toString("hex");
              const multiassetAmt = multiasset.get_asset(policyId, assetName);
              const assetAmount = multiassetAmt.to_str();
              if (!assetsSummary[policyIdString][assetNameHex]) {
                assetsSummary[policyIdString][assetNameHex] =
                  Number(assetAmount);
              } else {
                assetsSummary[policyIdString][assetNameHex] +=
                  Number(assetAmount);
              }
            }
          }
        }
      }
    } catch (err) {
      console.log(err);
    }

    const assetDetail = await getAssetDetails(assetsSummary);
    const assetsAmount = getCompleteTokenArray(
      adaAmount,
      assetsSummary,
      assetDetail
    );
    return assetsAmount;
  };

  return {
    enableWallet: enableWallet,
    getTokenArrayInWallet: getTokenArrayInWallet,
  };
}

function parseUtxo(rawUtxo: string) {
  const utxo = TransactionUnspentOutput.from_bytes(Buffer.from(rawUtxo, "hex"));
  const output = utxo.output();
  const amount = output.amount().coin().to_str(); // ADA amount in lovelace
  const multiasset = output.amount().multiasset();
  return {
    amount,
    multiasset,
  };
}

function convertBufferToHex(inBuffer: Uint8Array): string {
  const inString = Buffer.from(inBuffer, "utf8").toString("hex");
  return inString;
}

async function getAssetDetails(assetsSummary: AssetAmount) {
  const url = "https://token-registry-api.apexpool.info/api/v0/tokens";
  const tokens: { policy_id: string; token_name: string }[] = [];
  for (let policyId in assetsSummary) {
    for (let assetName in assetsSummary[policyId]) {
      tokens.push({
        policy_id: policyId,
        token_name: assetName,
      });
    }
  }
  const res = await axios.post(url, { tokens });
  return res.data;
}

function getCompleteTokenArray(
  adaAmount: number,
  assetAmount: AssetAmount,
  assetDetail: AssetDetail[]
) {
  const tokens: Token[] = [
    {
      name: "ADA",
      amount: adaAmount,
      decimals: 6,
      ticker: "",
      policyId: "",
      nameHex: "",
    },
  ];
  for (let token of assetDetail) {
    const { ticker, policy_id, decimals, name_hex } = token;
    tokens.push({
      name: ticker,
      amount: assetAmount[policy_id][name_hex],
      decimals: decimals,
      ticker: ticker,
      policyId: policy_id,
      nameHex: name_hex,
    });
  }
  return tokens;
}
