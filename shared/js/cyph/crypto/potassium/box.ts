import {Lib} from './lib';
import * as NativeCrypto from './nativecrypto';
import {OneTimeAuth} from './onetimeauth';
import {SecretBox} from './secretbox';
import {Util} from './util';


/** Equivalent to sodium.crypto_box. */
export class Box {
	/** @ignore */
	private readonly helpers: {
		keyPair: () => Promise<{
			keyType: string;
			publicKey: Uint8Array;
			privateKey: Uint8Array;
		}>;
		nonceBytes: number;
		open: (
			cyphertext: Uint8Array,
			nonce: Uint8Array,
			keyPair: {publicKey: Uint8Array; privateKey: Uint8Array}
		) => Promise<Uint8Array>;
		privateKeyBytes: number;
		publicKeyBytes: number;
		seal: (
			plaintext: Uint8Array,
			nonce: Uint8Array,
			publicKey: Uint8Array
		) => Promise<Uint8Array>;
	}	= {
		keyPair: async () : Promise<{
			keyType: string;
			publicKey: Uint8Array;
			privateKey: Uint8Array;
		}> => Lib.sodium.crypto_box_keypair(),

		nonceBytes: Lib.sodium.crypto_box_NONCEBYTES,

		open: async (
			cyphertext: Uint8Array,
			nonce: Uint8Array,
			keyPair: {publicKey: Uint8Array; privateKey: Uint8Array}
		) : Promise<Uint8Array> => Lib.sodium.crypto_box_seal_open(
			cyphertext,
			keyPair.publicKey,
			keyPair.privateKey
		),

		privateKeyBytes: Lib.sodium.crypto_box_SECRETKEYBYTES,

		publicKeyBytes: Lib.sodium.crypto_box_PUBLICKEYBYTES,

		seal: async (
			plaintext: Uint8Array,
			nonce: Uint8Array,
			publicKey: Uint8Array
		) : Promise<Uint8Array> => Lib.sodium.crypto_box_seal(
			plaintext,
			publicKey
		)
	};

	/** Private key length. */
	public readonly privateKeyBytes: number	=
		Lib.mcEliece.privateKeyLength +
		Lib.ntru.privateKeyLength +
		this.helpers.privateKeyBytes
	;

	/** Public key length. */
	public readonly publicKeyBytes: number	=
		Lib.mcEliece.publicKeyLength +
		Lib.ntru.publicKeyLength +
		this.helpers.publicKeyBytes
	;

	/** @ignore */
	private async publicKeyDecrypt (
		keyCyphertext: Uint8Array,
		privateKey: Uint8Array,
		name: string,
		encryptedKeyBytes: number,
		decrypt: (cyphertext: Uint8Array, privateKey: Uint8Array) => Uint8Array
	) : Promise<{
		innerKeys: Uint8Array,
		symmetricKey: Uint8Array
	}> {
		const encryptedKeys: Uint8Array	= new Uint8Array(
			keyCyphertext.buffer,
			keyCyphertext.byteOffset,
			encryptedKeyBytes
		);

		const mac: Uint8Array			= new Uint8Array(
			keyCyphertext.buffer,
			keyCyphertext.byteOffset + encryptedKeyBytes,
			this.oneTimeAuth.bytes
		);

		const innerKeys: Uint8Array		= decrypt(
			encryptedKeys,
			privateKey
		);

		const symmetricKey: Uint8Array	= new Uint8Array(
			innerKeys.buffer,
			0,
			this.secretBox.keyBytes
		);

		const authKey: Uint8Array		= new Uint8Array(
			innerKeys.buffer,
			this.secretBox.keyBytes,
			this.oneTimeAuth.keyBytes
		);

		const isValid: boolean			= await this.oneTimeAuth.verify(
			mac,
			encryptedKeys,
			authKey
		);

		if (!isValid) {
			Util.clearMemory(innerKeys);
			throw new Error(`Invalid ${name} cyphertext.`);
		}

		return {innerKeys, symmetricKey};
	}

	/** @ignore */
	private async publicKeyEncrypt (
		publicKey: Uint8Array,
		name: string,
		plaintextBytes: number,
		encrypt: (plaintext: Uint8Array, publicKey: Uint8Array) => Uint8Array
	) : Promise<{
		innerKeys: Uint8Array,
		symmetricKey: Uint8Array,
		keyCyphertext: Uint8Array
	}> {
		if (plaintextBytes < (this.secretBox.keyBytes + this.oneTimeAuth.keyBytes)) {
			throw new Error(`Not enough space for keys; must increase ${name} parameters.`);
		}

		const innerKeys: Uint8Array		= Util.randomBytes(plaintextBytes);

		const symmetricKey: Uint8Array	= new Uint8Array(
			innerKeys.buffer,
			0,
			this.secretBox.keyBytes
		);

		const authKey: Uint8Array		= new Uint8Array(
			innerKeys.buffer,
			this.secretBox.keyBytes,
			this.oneTimeAuth.keyBytes
		);

		const encryptedKeys: Uint8Array	= encrypt(
			innerKeys,
			publicKey
		);

		const mac: Uint8Array			= await this.oneTimeAuth.sign(
			encryptedKeys,
			authKey
		);

		return {
			innerKeys,
			symmetricKey,
			keyCyphertext: Util.concatMemory(
				true,
				encryptedKeys,
				mac
			)
		};
	}

	/** @ignore */
	private splitKeys (publicKey?: Uint8Array, privateKey?: Uint8Array) : {
		private: {classical: Uint8Array; mcEliece: Uint8Array; ntru: Uint8Array};
		public: {classical: Uint8Array; mcEliece: Uint8Array; ntru: Uint8Array};
	} {
		return {
			private: !privateKey ? null : {
				classical: new Uint8Array(
					privateKey.buffer,
					privateKey.byteOffset,
					this.helpers.privateKeyBytes
				),
				mcEliece: new Uint8Array(
					privateKey.buffer,
					privateKey.byteOffset +
						this.helpers.privateKeyBytes
					,
					Lib.mcEliece.privateKeyLength
				),
				ntru: new Uint8Array(
					privateKey.buffer,
					privateKey.byteOffset +
						this.helpers.privateKeyBytes +
						Lib.mcEliece.privateKeyLength
					,
					Lib.ntru.privateKeyLength
				)
			},
			public: !publicKey ? null : {
				classical: new Uint8Array(
					publicKey.buffer,
					publicKey.byteOffset,
					this.helpers.publicKeyBytes
				),
				mcEliece: new Uint8Array(
					publicKey.buffer,
					publicKey.byteOffset +
						this.helpers.publicKeyBytes
					,
					Lib.mcEliece.publicKeyLength
				),
				ntru: new Uint8Array(
					publicKey.buffer,
					publicKey.byteOffset +
						this.helpers.publicKeyBytes +
						Lib.mcEliece.publicKeyLength
					,
					Lib.ntru.publicKeyLength
				)
			}
		};
	}

	/** Generates key pair. */
	public async keyPair () : Promise<{
		keyType: string;
		publicKey: Uint8Array;
		privateKey: Uint8Array;
	}> {
		const keyPairs	= {
			classical: await this.helpers.keyPair(),
			mcEliece: Lib.mcEliece.keyPair(),
			ntru: Lib.ntru.keyPair()
		};

		return {
			keyType: 'potassium-box',
			privateKey: Util.concatMemory(
				true,
				keyPairs.classical.privateKey,
				keyPairs.mcEliece.privateKey,
				keyPairs.ntru.privateKey
			),
			publicKey: Util.concatMemory(
				true,
				keyPairs.classical.publicKey,
				keyPairs.mcEliece.publicKey,
				keyPairs.ntru.publicKey
			)
		};
	}

	/** Encrypts plaintext. */
	public async seal (
		plaintext: Uint8Array,
		publicKey: Uint8Array
	) : Promise<Uint8Array> {
		const keys	= this.splitKeys(publicKey);

		const mcElieceData						= await this.publicKeyEncrypt(
			keys.public.mcEliece,
			'McEliece',
			Lib.mcEliece.decryptedDataLength,
			Lib.mcEliece.encrypt
		);

		const ntruData							= await this.publicKeyEncrypt(
			keys.public.ntru,
			'NTRU',
			Lib.ntru.decryptedDataLength,
			Lib.ntru.encrypt
		);

		const nonce: Uint8Array					= this.newNonce(this.helpers.nonceBytes);

		const classicalCyphertext: Uint8Array	= await this.helpers.seal(
			plaintext,
			nonce,
			keys.public.classical
		);
		const ntruCyphertext: Uint8Array		= await this.secretBox.seal(
			classicalCyphertext,
			ntruData.symmetricKey
		);
		const mcElieceCyphertext: Uint8Array	= await this.secretBox.seal(
			ntruCyphertext,
			mcElieceData.symmetricKey
		);

		Util.clearMemory(ntruData.innerKeys);
		Util.clearMemory(mcElieceData.innerKeys);

		return Util.concatMemory(
			true,
			mcElieceData.keyCyphertext,
			ntruData.keyCyphertext,
			nonce,
			mcElieceCyphertext
		);
	}

	/** Decrypts cyphertext. */
	public async open (
		cyphertext: Uint8Array,
		keyPair: {publicKey: Uint8Array; privateKey: Uint8Array}
	) : Promise<Uint8Array> {
		const keys	= this.splitKeys(keyPair.publicKey, keyPair.privateKey);

		let cyphertextIndex	= cyphertext.byteOffset;

		const mcElieceData						= await this.publicKeyDecrypt(
			new Uint8Array(
				cyphertext.buffer,
				cyphertextIndex,
				Lib.mcEliece.encryptedDataLength +
					this.oneTimeAuth.bytes
			),
			keys.private.mcEliece,
			'McEliece',
			Lib.mcEliece.encryptedDataLength,
			Lib.mcEliece.decrypt
		);

		cyphertextIndex +=
			Lib.mcEliece.encryptedDataLength +
			this.oneTimeAuth.bytes
		;

		const ntruData							= await this.publicKeyDecrypt(
			new Uint8Array(
				cyphertext.buffer,
				cyphertextIndex,
				Lib.ntru.encryptedDataLength +
					this.oneTimeAuth.bytes
			),
			keys.private.ntru,
			'NTRU',
			Lib.ntru.encryptedDataLength,
			Lib.ntru.decrypt
		);

		cyphertextIndex +=
			Lib.ntru.encryptedDataLength +
			this.oneTimeAuth.bytes
		;

		const nonce: Uint8Array					= new Uint8Array(
			cyphertext.buffer,
			cyphertextIndex,
			this.helpers.nonceBytes
		);

		cyphertextIndex += this.helpers.nonceBytes;

		const mcElieceCyphertext: Uint8Array	= new Uint8Array(
			cyphertext.buffer,
			cyphertextIndex,
			cyphertext.byteLength -
				(cyphertextIndex - cyphertext.byteOffset)
		);
		const ntruCyphertext: Uint8Array		= await this.secretBox.open(
			mcElieceCyphertext,
			mcElieceData.symmetricKey
		);
		const classicalCyphertext: Uint8Array	= await this.secretBox.open(
			ntruCyphertext,
			ntruData.symmetricKey
		);

		const plaintext: Uint8Array	= await this.helpers.open(
			classicalCyphertext,
			nonce,
			{
				privateKey: keys.private.classical,
				publicKey: keys.public.classical
			}
		);

		Util.clearMemory(mcElieceData.innerKeys);
		Util.clearMemory(ntruData.innerKeys);
		Util.clearMemory(ntruCyphertext);
		Util.clearMemory(classicalCyphertext);

		return plaintext;
	}

	constructor (
		isNative: boolean,

		/** @ignore */
		private readonly newNonce: (size: number) => Uint8Array,

		/** @ignore */
		private readonly oneTimeAuth: OneTimeAuth,

		/** @ignore */
		private readonly secretBox: SecretBox
	) {
		if (isNative) {
			this.helpers.nonceBytes			= NativeCrypto.SecretBox.nonceBytes;
			this.publicKeyBytes				-= this.helpers.publicKeyBytes;
			this.helpers.publicKeyBytes		= NativeCrypto.Box.publicKeyBytes;
			this.publicKeyBytes				+= this.helpers.publicKeyBytes;
			this.privateKeyBytes			-= this.helpers.privateKeyBytes;
			this.helpers.privateKeyBytes	= NativeCrypto.Box.privateKeyBytes;
			this.privateKeyBytes			+= this.helpers.privateKeyBytes;
			this.helpers.keyPair			= NativeCrypto.Box.keyPair;
			this.helpers.seal				= NativeCrypto.Box.seal;
			this.helpers.open				= NativeCrypto.Box.open;
		}
	}
}