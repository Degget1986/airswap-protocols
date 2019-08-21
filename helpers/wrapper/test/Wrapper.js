const Swap = artifacts.require('Swap')
const Types = artifacts.require('Types')
const WrapperSimple = artifacts.require('WrapperSimple')
const WETH9 = artifacts.require('WETH9')
const FungibleToken = artifacts.require('FungibleToken')

const {
  emitted,
  equal,
  getResult,
  passes,
  ok,
} = require('@airswap/test-utils').assert
const { balances } = require('@airswap/test-utils').balances
const {
  getTimestampPlusDays,
  takeSnapshot,
  revertToSnapShot,
} = require('@airswap/test-utils').time
const { orders, signatures } = require('@airswap/order-utils')

let swapContract
let wrapperContract

let swapAddress
let wrapperAddress

let swapSimple
let tokenAST
let tokenDAI
let tokenWETH
let snapshotId

contract('WrapperSimple', async ([aliceAddress, bobAddress, carolAddress]) => {
  orders.setKnownAccounts([aliceAddress, bobAddress, carolAddress])

  before('Setup', async () => {
    let snapShot = await takeSnapshot()
    snapshotId = snapShot['result']
    // link types to swap
    await Swap.link(Types, (await Types.new()).address)
    // now deploy swap
    swapContract = await Swap.new()

    swapAddress = swapContract.address
    tokenWETH = await WETH9.new()
    wrapperContract = await WrapperSimple.new(swapAddress, tokenWETH.address)
    wrapperAddress = wrapperContract.address
    tokenDAI = await FungibleToken.new()
    tokenAST = await FungibleToken.new()

    await orders.setVerifyingContract(swapAddress)

    swapSimple =
      wrapperContract.methods[
        'swapSimple(uint256,uint256,address,uint256,address,address,uint256,address,uint8,bytes32,bytes32)'
      ]
  })

  after(async () => {
    await revertToSnapShot(snapshotId)
  })

  describe('Setup', async () => {
    it('Mints 1000 DAI for Alice', async () => {
      let tx = await tokenDAI.mint(aliceAddress, 1000)
      ok(await balances(aliceAddress, [[tokenDAI, 1000]]))
      emitted(tx, 'Transfer')
      passes(tx)
    })

    it('Mints 1000 AST for Bob', async () => {
      let tx = await tokenAST.mint(bobAddress, 1000)
      ok(await balances(bobAddress, [[tokenAST, 1000]]))
      emitted(tx, 'Transfer')
      passes(tx)
    })
  })

  describe('Approving...', async () => {
    it('Alice approves Swap to spend 1000 DAI', async () => {
      let result = await tokenDAI.approve(swapAddress, 1000, {
        from: aliceAddress,
      })
      emitted(result, 'Approval')
    })

    it('Bob approves Swap to spend 1000 AST', async () => {
      let result = await tokenAST.approve(swapAddress, 1000, {
        from: bobAddress,
      })
      emitted(result, 'Approval')
    })
  })

  describe('Wrap Buys', async () => {
    it('Checks that Bob take a WETH order from Alice using ETH', async () => {
      const { order } = await orders.getOrder({
        maker: {
          wallet: aliceAddress,
          token: tokenDAI.address,
          param: 50,
        },
        taker: {
          token: tokenWETH.address,
          param: 10,
        },
      })
      const signature = await signatures.getSimpleSignature(
        order,
        aliceAddress,
        swapAddress
      )
      let result = await swapSimple(
        order.nonce,
        order.expiry,
        order.maker.wallet,
        order.maker.param,
        order.maker.token,
        order.taker.wallet,
        order.taker.param,
        order.taker.token,
        signature.v,
        signature.r,
        signature.s,
        { from: bobAddress, value: order.taker.param }
      )
      await passes(result)
      result = await getResult(swapContract, result.tx)
      emitted(result, 'Swap')
      ok(await balances(wrapperAddress, [[tokenDAI, 0], [tokenWETH, 0]]))
    })
  })

  describe('Unwrap Sells', async () => {
    it('Carol gets some WETH and approves on the Swap contract', async () => {
      let tx = await tokenWETH.deposit({ from: carolAddress, value: 10000 })
      passes(tx)
      emitted(tx, 'Deposit')
      tx = await tokenWETH.approve(swapAddress, 10000, { from: carolAddress })
      passes(tx)
      emitted(tx, 'Approval')
    })

    it('Alice authorizes the Wrapper to send orders on her behalf', async () => {
      let expiry = await getTimestampPlusDays(1)
      let tx = await swapContract.authorize(wrapperAddress, expiry, {
        from: aliceAddress,
      })
      passes(tx)
      emitted(tx, 'Authorize')
    })

    it('Alice approves the Swap contract to move her WETH', async () => {
      let tx = await tokenWETH.approve(wrapperAddress, 10000, {
        from: aliceAddress,
      })
      passes(tx)
      emitted(tx, 'Approval')
    })

    it('Checks that Alice receives ETH for a WETH order from Carol', async () => {
      const { order } = await orders.getOrder({
        maker: {
          wallet: carolAddress,
          token: tokenWETH.address,
          param: 10000,
        },
        taker: {
          wallet: aliceAddress,
          token: tokenDAI.address,
          param: 100,
        },
      })
      const signature = await signatures.getSimpleSignature(
        order,
        carolAddress,
        swapAddress
      )

      let result = await swapSimple(
        order.nonce,
        order.expiry,
        order.maker.wallet,
        order.maker.param,
        order.maker.token,
        order.taker.wallet,
        order.taker.param,
        order.taker.token,
        signature.v,
        signature.r,
        signature.s,
        { from: aliceAddress }
      )
      passes(result)
      result = await getResult(swapContract, result.tx)
      emitted(result, 'Swap')
      ok(await balances(wrapperAddress, [[tokenDAI, 0], [tokenWETH, 0]]))
    })
  })

  describe('Sending Ether and WETH to the WrapperContract without swapSimple issues', async () => {
    it('Sending Ether to the Wrapper Contract', async () => {
      await web3.eth.sendTransaction({
        to: wrapperAddress,
        from: aliceAddress,
        value: 100000,
        data: '0x0',
      })

      equal(await web3.eth.getBalance(wrapperAddress), 100000)
    })
    it('Sending WETH to the Wrapper Contract', async () => {
      const startingBalance = await tokenWETH.balanceOf(wrapperAddress)
      await tokenWETH.transfer(wrapperAddress, 5, { from: aliceAddress })
      ok(
        await balances(wrapperAddress, [
          [tokenWETH, startingBalance.toNumber() + 5],
        ])
      )
    })

    it('Alice approves Swap to spend 1000 DAI', async () => {
      let result = await tokenDAI.approve(swapAddress, 1000, {
        from: aliceAddress,
      })
      emitted(result, 'Approval')
    })

    it('Send order where Bob sends Eth to Alice for DAI', async () => {
      const { order } = await orders.getOrder({
        maker: {
          wallet: aliceAddress,
          token: tokenDAI.address,
          param: 50,
        },
        taker: {
          token: tokenWETH.address,
          param: 10,
        },
      })
      const signature = await signatures.getSimpleSignature(
        order,
        aliceAddress,
        swapAddress
      )
      let result = await swapSimple(
        order.nonce,
        order.expiry,
        order.maker.wallet,
        order.maker.param,
        order.maker.token,
        order.taker.wallet,
        order.taker.param,
        order.taker.token,
        signature.v,
        signature.r,
        signature.s,
        { from: bobAddress, value: order.taker.param }
      )
      await passes(result)
      result = await getResult(swapContract, result.tx)
      emitted(result, 'Swap')
      equal(await web3.eth.getBalance(wrapperAddress), 100000)
      ok(await balances(wrapperAddress, [[tokenDAI, 0], [tokenWETH, 5]]))
    })
  })
  describe('Sending nonWETH ERC20', async () => {
    it('Alice approves Swap to spend 1000 DAI', async () => {
      let result = await tokenDAI.approve(swapAddress, 1000, {
        from: aliceAddress,
      })
      emitted(result, 'Approval')
    })

    it('Bob approves Swap to spend 1000 AST', async () => {
      let result = await tokenAST.approve(swapAddress, 1000, {
        from: bobAddress,
      })
      emitted(result, 'Approval')
    })

    it('Bob authorizes the Wrapper to send orders on her behalf', async () => {
      let expiry = await getTimestampPlusDays(1)
      let tx = await swapContract.authorize(wrapperAddress, expiry, {
        from: bobAddress,
      })
      passes(tx)
      emitted(tx, 'Authorize')
    })

    it('Send order where Bob sends AST to Alice for DAI', async () => {
      const { order } = await orders.getOrder({
        maker: {
          wallet: aliceAddress,
          token: tokenDAI.address,
          param: 1,
        },
        taker: {
          wallet: bobAddress,
          token: tokenAST.address,
          param: 100,
        },
      })
      const signature = await signatures.getSimpleSignature(
        order,
        aliceAddress,
        swapAddress
      )
      let result = await swapSimple(
        order.nonce,
        order.expiry,
        order.maker.wallet,
        order.maker.param,
        order.maker.token,
        order.taker.wallet,
        order.taker.param,
        order.taker.token,
        signature.v,
        signature.r,
        signature.s,
        { from: bobAddress, value: 0 }
      )
      await passes(result)
      result = await getResult(swapContract, result.tx)
      emitted(result, 'Swap')
      equal(await web3.eth.getBalance(wrapperAddress), 100000)
      ok(
        await balances(wrapperAddress, [
          [tokenAST, 0],
          [tokenDAI, 0],
          [tokenWETH, 5],
        ])
      )
    })
  })
})
