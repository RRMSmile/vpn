# SafeVPN iOS MVP (iOS-only, 1 device)

## Screens
- Login (code from Telegram)
- Home: connect toggle, traffic, change server, subscription status
- Settings: device id (copy), rotate VPN key, transfer subscription, manage subscription

## Core rules
- 1 device per subscription (hard limit)
- Transfer flow via transfer_code
- PrivateKey generated on device; backend stores only publicKey
