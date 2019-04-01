const _ = require('@keyring/util');
_.ecc = require('ecc-tools');
_.hash = _.ecc;

const Input = require('./input');
const Output = require('./output');
const Script = require('./script');
const Sighash = require('./sighash');

class Transaction {
  get _chain() { return false; }
  get _class() { return Transaction; }
  get _inputClass() { return Input; }
  get _outputClass() { return Output; }
  get _feePerByte() { return new (_.bn)(100); }

  constructor(raw={}) {
    if (_.r.is(Transaction, raw)) { return raw; }
    if (_.r.is(Buffer, raw) || typeof raw === 'string') {
      return new _.Parser(this._class).parse(raw);
    }

    this.raw = Object.assign({
      version: 0x01,
      inputs: [],
      outputs: [],
      locktime: 0
    }, raw);

    this.version = this.raw.version;
    this.inputs = this.raw.inputs;
    this.outputs = this.raw.outputs;
    this.locktime = this.raw.locktime;

    this._sighash = new Sighash(this);

    _.r.forEach((output) => { output.tx = this; }, this.outputs);

    return this;
  }

  get buf() {
    return new _.Writer()
      .uint32le(this.version)
      .write(this.inputs)
      .write(this.outputs)
      .uint32le(this.locktime)
      .buf;
  }

  get hex() { return this.buf.toString('hex'); }
  get hash() { return _.hash.sha256sha256(this.buf); }
  get id() { return _.buf.reverse(this.hash); }
  get txin() { return _.r.pluck('txid', this.inputs); }
  get size() { return new (_.bn)(this.buf.length); }

  get clone() { return new (this._class)(Object.assign({}, this.raw)); }

  get inputAmount() {
    return _.r.reduce((total, amount) => {
      return total.add(amount);
    }, new (_.bn)(0), _.r.pluck('amount', this.inputs));
  }

  get outputAmount() {
    return _.r.reduce((total, amount) => {
      return total.add(amount);
    }, new (_.bn)(0), _.r.pluck('amount', this.outputs));
  }

  get changeAmount() {
    if(_.r.isNil(this._changeIndex)) {
      return this.unspent - this.fee;
    } else {
      return this.outputs[this._changeIndex].amount;
    };
  }

  get unspent() { return this.inputAmount.sub(this.outputAmount); }

  get suggestedFee() { return this._feePerByte.mul(this.size); }

  fee(amount) {
    if (_.r.isNil(amount)) {
      return this._fee || this.unspent;
    } else {
      this._fee = new (_.bn)(amount);
      return this;
    }
  }

  to(hash, amount) {
    let script = new (this._outputClass.Script)('p2pkh', hash);
    this.outputs.push(new Output({amount, script}));
    return this;
  }

  from(tx, index=0, sequence) {
    tx = new (this._class)(tx);
    let output = tx.outputs[index];
    let input = new (this._inputClass)({
      txid: tx.id,
      index: index,
      script: '',
      sequence: sequence
    }, output.script, output.amount);
    this.inputs.push(input);
    return this;
  }

  change(hash) {
    if(_.r.isNil(this._changeIndex)) {
      this._changeIndex = this.outputs.length;
      this.outputs.push(new (this._outputClass)());
    }

    let output = this.outputs[this._changeIndex];
    output.script = new(this._outputClass.Script)('p2pkh', hash);
    output.amount = this.unspent.sub(this.suggestedFee);

    return this;
  }

  sign(key, type=0x01) {
    if (_.r.is(String, key)) { key = Buffer.from(key, 'hex'); }
    let pub = _.ecc.publicKey(key, true);
    let hash = _.ecc.sha256ripemd160(pub).toString('hex');

    _.r.addIndex(_.r.forEach)((input, index) => {
      if (input.complete && input.source[0].toString('hex') === hash) {
        let sighash = this.sighash(index, type);
        input.script = new (this._inputClass.Script)('signature', key, sighash, type);
      }
      return false;
    }, this.inputs);

    return this;
  }

  sighash(index, type=0x01) {
    let input = this.inputs[index];
    let subscript = input.subscript;
    let amount = input.amount;
    return this._sighash.hash(index, subscript, amount, type);
  }

  static template() {
    return [
      ['version', 'uint32le'],
      ['inputs', [Input]],
      ['outputs', [Output]],
      ['locktime', 'uint32le']
    ];
  }

  static for(chain) {
    const OutputClass = Output.for(chain);
    const InputClass = Input.for(chain);

    class TransactionClass extends Transaction {
      get _chain() { return chain; }
      get _class() { return TransactionClass; }

      get _inputClass() { return InputClass; }
      get _outputClass() { return OutputClass; }

      static template() {
        return [
          ['version', 'uint32le'],
          ['inputs', [InputClass]],
          ['outputs', [OutputClass]],
          ['locktime', 'uint32le']
        ];
      }
    }

    TransactionClass.chain = chain;
    TransactionClass.Input = InputClass;
    TransactionClass.Output = OutputClass;

    return TransactionClass;
  }
}

Transaction.chain = false;

module.exports = Transaction;
