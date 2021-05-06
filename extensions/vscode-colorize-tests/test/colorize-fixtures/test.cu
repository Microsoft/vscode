#include <stdlib.h>
#include <stdio.h>
#include <unistd.h>

#include <cuda_runtime.h>

#if defined(assert)
#undef assert
#endif

#define assert(c) \
    do { \
        if(!(c)) { \
            fprintf(stderr, "Assertion \"%s\" failed. (%s:%d)\n", \
                #c, __FILE__, __LINE__); \
            exit(1); \
        } \
    } while(0)

#define assertSucceeded(c) \
    do { \
        unsigned __tmp = c; \
        if(__tmp != cudaSuccess) { \
            fprintf(stderr, "Operation \"%s\" failed with error code %x. (%s:%d)\n", \
                #c, (__tmp), __FILE__, __LINE__); \
            exit(__tmp); \
        } \
    } while(0)

#define ARRAY_LENGTH(x) (sizeof(x) / sizeof(x[0]))

constexpr int dataLength = 1 << 24;
constexpr int threadsPerBlock = 128;

typedef unsigned char byte;

struct TestType
{
    union {
        struct
        {
            unsigned lowHalf;
            unsigned highHalf;
        } halfAndHalf;

        unsigned long long whole;
    } takeYourPick;

    int arr[5];

    struct {
        char a;
        char b;
    } structArr[5];

    float theFloats[2];
    double theDouble;
};

__global__ void cudaComputeHash(TestType* input, unsigned *results)
{
    int idx = blockIdx.x * threadsPerBlock + threadIdx.x;
    TestType* myInput = input + idx;

    unsigned myResult = 0;

    myResult += myInput->takeYourPick.halfAndHalf.lowHalf - idx;
    myResult += myInput->takeYourPick.halfAndHalf.highHalf - idx;

    for(size_t i = 0; i < ARRAY_LENGTH(myInput->arr); i++)
    {
        myResult += myInput->arr[i] - idx;
    }

    for(size_t i = 0; i < sizeof(myInput->structArr); i++)
    {
        myResult += reinterpret_cast<byte *>(myInput->structArr)[i] - '0';
    }

    __syncthreads();

    results[idx] = myResult;
}

int main()
{
    int cudaDeviceCount;
    assertSucceeded(cudaGetDeviceCount(&cudaDeviceCount));
    assert(cudaDeviceCount > 0);

    assertSucceeded(cudaSetDevice(0));

    TestType* input;
    unsigned* results;

    assertSucceeded(cudaMallocManaged(&input, sizeof(TestType) * dataLength));
    assert(!!input);

    for (size_t i = 0; i < dataLength; i++)
    {
        input[i].takeYourPick.halfAndHalf.lowHalf = i + 1;
        input[i].takeYourPick.halfAndHalf.highHalf = i + 3;

        for(size_t j = 0; j < ARRAY_LENGTH(input[i].arr); j++)
        {
            input[i].arr[j] = i + j + 2;
        }

        for(size_t j = 0; j < sizeof(input[i].structArr); j++)
        {
            reinterpret_cast<byte *>(input[i].structArr)[j] = '0' + static_cast<char>((i + j) % 10);
        }

        input[i].theFloats[0] = i + 1;
        input[i].theFloats[1] = input[i].theFloats[0] / 2;

        input[i].theDouble = input[i].theFloats[1] + 1;
    }

    assertSucceeded(cudaMallocManaged(reinterpret_cast<void **>(&results), sizeof(unsigned) * dataLength));
    assert(!!results);

    constexpr int blocks = dataLength / threadsPerBlock;
    cudaComputeHash<<<blocks, threadsPerBlock>>>(input, results);

    assertSucceeded(cudaDeviceSynchronize());

    const unsigned expectedResult =
        1 +
        3 +
        ARRAY_LENGTH(input[0].arr) * (ARRAY_LENGTH(input[0].arr) - 1) / 2 +
        ARRAY_LENGTH(input[0].arr) * 2 +
        sizeof(input[0].structArr) * (sizeof(input[0].structArr) - 1) / 2;

    for (unsigned i = 0; i < dataLength; i++)
    {
        if (results[i] != expectedResult){
            fprintf(stderr, "results[%u] (%u) != %u\n", i, results[i], expectedResult);
            exit(1);
        }
    }

    assertSucceeded(cudaFree(input));
    assertSucceeded(cudaFree(results));

    fprintf(stderr, "Success\n");

    exit(0);
}
